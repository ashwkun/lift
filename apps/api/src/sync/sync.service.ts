/**
 * Sync engine, server side.
 *
 * Two operations: clients push a batch of local mutations, then pull everything
 * that changed since their cursor. Both are scoped to one user and safe to
 * retry.
 */

import {
  clampUpdatedAt,
  shouldOverwrite,
  SYNCABLE_TABLES,
  type Mutation,
  type SyncConflict,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@lift/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, getTableColumns, gt, lt, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { syncReceipts, SYNC_TABLES, type SyncTableName } from '../db/schema.js';

/** Columns the client must never dictate. The server owns these. */
const SERVER_OWNED = new Set(['userId', 'seq']);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  /**
   * Applies a batch of client mutations.
   *
   * Mutations are applied in `clientSeq` order inside a single transaction, so
   * causality is preserved. A set can never land before the workout it belongs
   * to, and a failure part-way leaves nothing half-applied.
   *
   * Each mutation additionally runs inside its own SAVEPOINT, so one that the
   * schema refuses is rolled back alone rather than taking the batch with it.
   * See the comment on that block for why a plain try/catch was not enough.
   */
  async push(
    userId: string,
    deviceId: string,
    mutations: Mutation[],
  ): Promise<SyncPushResponse> {
    const applied: number[] = [];
    const conflicts: SyncConflict[] = [];

    const ordered = [...mutations].sort((a, b) => a.clientSeq - b.clientSeq);

    /**
     * One clock reading for the whole batch.
     *
     * Every mutation in a push is judged against the same server "now", so two
     * rows in one batch cannot be clamped differently because the loop took a
     * millisecond to reach the second one.
     */
    const serverNow = Date.now();

    /**
     * The highest effective timestamp already written to each row in this batch.
     *
     * Two mutations for one row in a single push is ordinary: `trackDelete` does
     * not coalesce an earlier `upsert` for the same row the way
     * `trackUpsertCoalesced` does, so logging a set and then removing it leaves
     * both entries in the oplog and they go up together.
     *
     * Without this map they can tie, and a tie is fatal in a specific direction.
     * Clamping maps every timestamp above the ceiling onto the *same* ceiling,
     * so on a device more than the tolerance fast, every mutation in the batch
     * collapses to one value. The second one for a given row then compares equal
     * to the row the first one just wrote, `shouldOverwrite` gives ties to the
     * incumbent, and the server answers `stale` with the row being superseded.
     * The client's answer to `stale` is to take the server's row and drop the
     * oplog entry, so a delete that lost a tie leaves the row alive locally,
     * alive on the server, marked synced, and with nothing left to retry: a
     * deleted set silently comes back and counts toward volume and PRs again.
     *
     * Ties are not only reachable through the clamp. Two writes to one row in
     * the same millisecond produce equal raw timestamps and resurrect a row the
     * same way, which was true before any clamping existed.
     *
     * So mutations are made strictly increasing per row, in the `clientSeq`
     * order they are already applied in. Causal order on the device decides,
     * which is the order the user performed them in.
     */
    const batchFloor = new Map<string, number>();

    await db.transaction(async (tx) => {
      // A retried push must not re-apply work. Anything already receipted is
      // acknowledged without touching the row again.
      const seen = await tx
        .select({ clientSeq: syncReceipts.clientSeq })
        .from(syncReceipts)
        .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.deviceId, deviceId)));

      const alreadyApplied = new Set(seen.map((row) => row.clientSeq));

      for (const mutation of ordered) {
        if (alreadyApplied.has(mutation.clientSeq)) {
          applied.push(mutation.clientSeq);
          continue;
        }

        const table = SYNC_TABLES[mutation.table as SyncTableName];
        if (!table) {
          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason: 'invalid',
            serverRow: null,
          });
          continue;
        }

        /**
         * The client's timestamp, bounded to something this server can believe.
         *
         * Used for the comparison below *and* written to the row, so the two can
         * never disagree. `clampUpdatedAt` explains why an unbounded value is a
         * silent data-loss bug rather than an untidy one.
         */
        const rowKey = `${mutation.table}/${mutation.rowId}`;
        const clamped = clampUpdatedAt(mutation.updatedAt, serverNow);
        const floor = batchFloor.get(rowKey);

        // Strictly above anything this batch has already written to this row.
        // See `batchFloor` for why a tie here resurrects deleted rows.
        const effectiveUpdatedAt =
          floor !== undefined && clamped <= floor ? floor + 1 : clamped;

        batchFloor.set(rowKey, effectiveUpdatedAt);

        const [existing] = await tx
          .select()
          .from(table)
          .where(eq(table.id, mutation.rowId))
          .limit(1);

        // A row that exists under a different user is not ours to touch. This
        // is the check that stops a client claiming someone else's UUID.
        if (existing && existing.userId !== userId) {
          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason: 'forbidden',
            serverRow: null,
          });
          continue;
        }

        if (existing && !shouldOverwrite(effectiveUpdatedAt, Number(existing.updatedAt))) {
          // The server's copy is newer or identical. Hand it back so the client
          // can replace its stale local version.
          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason: 'stale',
            serverRow: existing as Record<string, unknown>,
          });
          continue;
        }

        /**
         * Did the write land, or did a concurrent commit beat it?
         *
         * The two checks above read a snapshot. Between that read and the write
         * another connection can commit a newer version of the same row, and
         * under READ COMMITTED an unconditional upsert would then let commit
         * order pick the winner instead of `updatedAt`. The guards below make
         * the write itself conditional, so the loser writes nothing and finds
         * out, rather than silently overwriting a newer row.
         */
        let lostRace = false;

        try {
          /**
           * One SAVEPOINT per mutation.
           *
           * A plain try/catch here does not do what it reads as. Postgres marks
           * the whole transaction aborted on the first error, so every later
           * statement fails with 25P02 and the outer COMMIT throws: one payload
           * the schema refuses discarded every applied row *and every receipt*
           * in the batch, returned 500, and left the client re-pushing the same
           * poison mutation forever behind a queue that could never drain.
           * `tx.transaction()` emits a real SAVEPOINT, which is what makes the
           * per-mutation rejection below actually per-mutation.
           */
          await tx.transaction(async (sp) => {
            if (mutation.op === 'delete') {
              if (existing) {
                const tombstoned = await sp
                  .update(table)
                  .set({
                    deletedAt: effectiveUpdatedAt,
                    updatedAt: effectiveUpdatedAt,
                    seq: sql`nextval('sync_seq')`,
                  })
                  // `userId` belongs in this predicate even though the check
                  // above passed: it is the one that holds if the snapshot is
                  // stale, and a delete is the least recoverable write here.
                  .where(
                    and(
                      eq(table.id, mutation.rowId),
                      eq(table.userId, userId),
                      lt(table.updatedAt, effectiveUpdatedAt),
                    ),
                  )
                  .returning({ id: table.id });

                if (tombstoned.length === 0) {
                  lostRace = true;
                  return;
                }
              }
              // Deleting a row we've never seen is a no-op, not an error. The
              // client may have created and deleted it while offline.
            } else {
              const values = this.sanitize(
                table,
                mutation.payload ?? {},
                userId,
                effectiveUpdatedAt,
              );

              /**
               * Drizzle types inserts per-table, but the target here is picked at
               * runtime from a heterogeneous map, so the row shape is genuinely
               * not inferable. `sanitize()` is the runtime guarantee that only
               * real columns (never `userId` or `seq`) reach this call.
               */
              const writer = sp.insert(table) as unknown as {
                values: (row: Record<string, unknown>) => {
                  onConflictDoUpdate: (config: {
                    target: unknown;
                    set: Record<string, unknown>;
                    setWhere: unknown;
                  }) => {
                    returning: (columns: Record<string, unknown>) => Promise<unknown[]>;
                  };
                };
              };

              const written = await writer
                .values(values)
                .onConflictDoUpdate({
                  target: table.id,
                  set: { ...values, seq: sql`nextval('sync_seq')` },
                  setWhere: and(
                    eq(table.userId, userId),
                    lt(table.updatedAt, effectiveUpdatedAt),
                  ),
                })
                .returning({ id: table.id });

              // An insert returns its row; a conflicting update returns one only
              // if `setWhere` held. Nothing back means the row moved under us.
              if (written.length === 0) {
                lostRace = true;
                return;
              }
            }

            await sp
              .insert(syncReceipts)
              .values({ userId, deviceId, clientSeq: mutation.clientSeq })
              .onConflictDoNothing();
          });
        } catch (error) {
          // Most likely a payload that doesn't fit the schema. Reject this one
          // mutation rather than failing the whole batch.
          this.logger.warn(
            `Rejected ${mutation.table}/${mutation.rowId}: ${(error as Error).message}`,
          );
          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason: 'invalid',
            serverRow: null,
          });
          continue;
        }

        if (lostRace) {
          /**
           * The predicate that failed was `userId AND updatedAt`, and which half
           * it was decides what the client is told, so the re-read is scoped to
           * the owner rather than to the id alone.
           *
           * A row returned here is one this user owns that moved underneath the
           * snapshot, which is an ordinary `stale`: hand back the winner and the
           * client takes it. Nothing returned means the row is not this user's,
           * which is `forbidden` with no row attached, exactly as the check
           * above reports it. Selecting on the id alone would answer a losing
           * write with somebody else's workout, and the client stores what it is
           * given.
           */
          const [winner] = await tx
            .select()
            .from(table)
            .where(and(eq(table.id, mutation.rowId), eq(table.userId, userId)))
            .limit(1);

          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason: winner ? 'stale' : 'forbidden',
            serverRow: winner ? (winner as Record<string, unknown>) : null,
          });
          continue;
        }

        applied.push(mutation.clientSeq);
      }
    });

    return { applied, conflicts, serverTime: Date.now() };
  }

  /**
   * Returns everything that changed after `cursor`.
   *
   * Because `seq` is a single global sequence, the merged result can be cut at
   * any point and the cursor advanced to that row's seq: the next page resumes
   * exactly where this one stopped, with no gap and no repeat.
   */
  async pull(userId: string, cursor: string | null, limit: number): Promise<SyncPullResponse> {
    const after = cursor ? Number(cursor) : 0;
    const safeLimit = Math.min(Math.max(limit, 1), 5000);

    const collected: { table: SyncTableName; seq: number; row: Record<string, unknown> }[] = [];

    /**
     * True if any single table filled its window.
     *
     * A table that returns exactly `safeLimit` rows may have more behind them,
     * and if it is the only table with anything to send then `collected.length`
     * lands on `safeLimit` exactly and the `>` test below reads as "caught up"
     * while rows sit past the cursor. The client believes it is done, and the
     * local database holds workouts whose sets are only partly present, which
     * is what volume totals, analytics and PR detection then read. A bulk
     * import writes table by table, so long single-table runs of `seq` are the
     * normal case here rather than a corner one.
     */
    let sawFullPage = false;

    for (const name of SYNCABLE_TABLES) {
      const table = SYNC_TABLES[name as SyncTableName];
      if (!table) continue;

      // Each table contributes at most `safeLimit` rows. Any row that belongs
      // in the merged prefix is guaranteed to be inside that window.
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), gt(table.seq, after)))
        .orderBy(table.seq)
        .limit(safeLimit);

      if (rows.length === safeLimit) sawFullPage = true;

      for (const row of rows) {
        collected.push({
          table: name as SyncTableName,
          seq: Number(row.seq),
          row: row as Record<string, unknown>,
        });
      }
    }

    collected.sort((a, b) => a.seq - b.seq);

    const page = collected.slice(0, safeLimit);
    // Erring towards one extra empty pull, never towards a silent short page.
    const hasMore = collected.length > safeLimit || sawFullPage;

    const changes: Record<string, Record<string, unknown>[]> = {};
    for (const entry of page) {
      // Strip server-internal columns; the client's schema has no place for them.
      const { userId: _owner, seq: _seq, ...rest } = entry.row;
      (changes[entry.table] ??= []).push(rest);
    }

    const nextCursor = page.length > 0 ? String(page[page.length - 1]!.seq) : String(after);

    return {
      changes: changes as SyncPullResponse['changes'],
      cursor: nextCursor,
      hasMore,
      serverTime: Date.now(),
    };
  }

  /**
   * Restricts an incoming payload to real columns and stamps ownership.
   *
   * Without this an attacker could set `userId` on a row and hand it to another
   * account, and unknown keys would make Drizzle throw.
   */
  private sanitize(
    table: (typeof SYNC_TABLES)[SyncTableName],
    payload: Record<string, unknown>,
    userId: string,
    effectiveUpdatedAt: number,
  ): Record<string, unknown> {
    const columns = getTableColumns(table);
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (!(key in columns)) continue;
      if (SERVER_OWNED.has(key)) continue;
      values[key] = value;
    }

    values.userId = userId;
    // The clamped value, not whatever the payload carried. The row that gets
    // stored has to be the row the comparison was made against, or the next
    // write compares against a timestamp this server never agreed to.
    values.updatedAt = effectiveUpdatedAt;
    return values;
  }

  /** Highest sequence value assigned to this user, for progress reporting. */
  async latestCursor(userId: string): Promise<string> {
    let max = 0;

    for (const name of SYNCABLE_TABLES) {
      const table = SYNC_TABLES[name as SyncTableName];
      if (!table) continue;

      const [row] = await db
        .select({ seq: table.seq })
        .from(table)
        .where(eq(table.userId, userId))
        .orderBy(sql`${table.seq} DESC`)
        .limit(1);

      if (row) max = Math.max(max, Number(row.seq));
    }

    return String(max);
  }
}
