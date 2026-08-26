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
import { and, eq, getTableColumns, gt, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { db } from '../db/client.js';
import {
  SYNC_PARENT_REFS,
  syncPurgeWatermarks,
  syncReceipts,
  SYNC_TABLES,
  type SyncTableName,
} from '../db/schema.js';

/** Columns the client must never dictate. The server owns these. */
const SERVER_OWNED = new Set(['userId', 'seq']);

/** Postgres `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * How many receipts to keep per device, counted back from the highest
 * `clientSeq` that device has just pushed.
 *
 * A receipt only has work to do between a push landing and the client reading
 * the response, which is seconds, so even one batch's worth would cover the
 * case it exists for. Ten thousand is deliberately far more than that: it also
 * covers a device that queued a long offline stretch and is draining it in
 * `PUSH_BATCH` chunks, and it costs a few hundred kilobytes per device.
 *
 * Dropping a receipt is safe rather than merely tolerable, which is what makes
 * a window acceptable at all. Nothing infers "applied" from a range: a mutation
 * whose receipt has been trimmed is simply applied again, and last-write-wins
 * decides what that means. An upsert replayed against the row it already wrote
 * ties on `updatedAt`, loses to the incumbent and comes back `stale` carrying
 * the client's own row, which the client stores and drops. A replayed delete
 * meets its own tombstone and does the same. The cost of too small a window is
 * a redundant conflict, not a lost write or a double one.
 */
const RECEIPT_WINDOW = 10_000;

/**
 * How long a tombstone is kept before a sweep may remove it.
 *
 * Ninety days is not a guess about databases, it is a guess about phones: a
 * device that has not synced inside a quarter is the one that loses a deletion
 * it never saw. See `purgeTombstones` for what the watermark does about that
 * and what it cannot do yet.
 *
 * Measured against `deletedAt`, which the client authors and `clampUpdatedAt`
 * only bounds in the future direction. A device with its clock set years back
 * therefore writes tombstones that are already past any horizon, and a sweep
 * would take them on the first pass. That asymmetry is deliberate: clamping the
 * past would mean a genuinely old offline edit could never lose a comparison it
 * should lose, and losing an old tombstone early is a smaller failure than
 * resurrecting rows on every device.
 */
const DEFAULT_TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * True when a write failed because the row it points at is not here.
 *
 * The SQLSTATE is on the driver's error, and Drizzle wraps that in a
 * `DrizzleQueryError`, so the code is one or two `cause` links down rather than
 * on the object that was thrown. Reading the message instead is not an option:
 * Postgres localises it through `lc_messages`, so a server started in another
 * locale would silently reclassify every one of these as `invalid` and the
 * client would retire mutations it should have retried.
 */
function isMissingParent(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * A pull response, plus the one key the shared schema does not carry yet.
 *
 * `resyncRequired` is a wire protocol change, and the protocol has no version
 * envelope: an old client cannot be told it is being sent something new, it can
 * only ignore it. Declaring the extension here rather than in
 * `@lift/shared/sync` keeps that honest. The shared contract still describes
 * exactly what every shipped client understands, and this file is where the
 * server admits it is sending one key more.
 */
export type SyncPullResponseWithWatermark = SyncPullResponse & { resyncRequired: boolean };

/** What one tombstone sweep removed. */
export interface TombstoneSweep {
  /** Rows removed, per table. Tables with nothing to purge are absent. */
  purged: Partial<Record<SyncTableName, number>>;
  removed: number;
  receiptsRemoved: number;
  /** The user's watermark after the sweep, as a cursor-comparable string. */
  watermark: string;
}

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

    const requested = ordered.map((mutation) => mutation.clientSeq);

    await db.transaction(async (tx) => {
      /**
       * A retried push must not re-apply work. Anything already receipted is
       * acknowledged without touching the row again.
       *
       * Scoped to the `clientSeq` values in this batch, which is the whole
       * question being asked. This used to select every receipt the device had
       * ever written and build a Set of all of them, so the cost of a push grew
       * with the device's lifetime history to answer at most a thousand
       * membership tests.
       *
       * The obvious cheaper shape, a single `high_water_client_seq` per device
       * with "anything at or below it is applied", is wrong here and quietly so.
       * `retryRejected()` on the client sets `attempts` back to zero on retired
       * entries and re-queues them, and a retired entry is by definition one the
       * server *rejected*, so it never had a receipt. Its `clientSeq` is old, it
       * sits below the high-water mark, and a range test would answer "already
       * applied" for a mutation that has never been applied at all. The client
       * deletes an acknowledged entry from its oplog, so the user's change would
       * be gone from the queue and absent from the server, with the sync card
       * reporting everything as synced. Exact membership cannot make that
       * mistake, so this stays exact and is bounded by the batch instead.
       */
      const seen =
        requested.length === 0
          ? []
          : await tx
              .select({ clientSeq: syncReceipts.clientSeq })
              .from(syncReceipts)
              .where(
                and(
                  eq(syncReceipts.userId, userId),
                  eq(syncReceipts.deviceId, deviceId),
                  inArray(syncReceipts.clientSeq, requested),
                ),
              );

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
          /**
           * The savepoint above is what makes this a per-mutation decision, and
           * a foreign key violation is the case it was worth telling apart.
           *
           * `invalid` and `missing_parent` are opposite instructions to the
           * client. `invalid` retires the entry: the row is malformed and no
           * amount of retrying will change that. `missing_parent` charges one
           * attempt and leaves the entry in the queue, because the row it points
           * at may simply not be here *yet*: it can be further down this device's
           * oplog behind a page boundary, or on another device that has not
           * pushed. Reporting a late parent as `invalid` would retire a set the
           * user logged, and a retired mutation is never sent again, so the
           * workout would stay on the phone and never reach the account.
           *
           * Anything else is a payload the schema refuses, and stays `invalid`.
           */
          const reason = isMissingParent(error) ? 'missing_parent' : 'invalid';

          this.logger.warn(
            `Rejected ${mutation.table}/${mutation.rowId} as ${reason}: ${(error as Error).message}`,
          );
          conflicts.push({
            clientSeq: mutation.clientSeq,
            rowId: mutation.rowId,
            table: mutation.table,
            reason,
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

      /**
       * Trim this device's ledger while we are already here.
       *
       * `clientSeq` is the device's own monotonic oplog counter, so counting
       * back from the highest one in this batch is a stable definition of "the
       * recent past" that needs no clock and reads straight down the
       * (user, device, client_seq) index. Doing it on the write path is what
       * keeps the table bounded for a device that is actually in use; a device
       * that stops pushing forever is left to the sweep, since nothing here will
       * ever run again for it.
       */
      const highest = requested.length > 0 ? requested[requested.length - 1]! : 0;

      if (applied.length > 0 && highest > RECEIPT_WINDOW) {
        await tx
          .delete(syncReceipts)
          .where(
            and(
              eq(syncReceipts.userId, userId),
              eq(syncReceipts.deviceId, deviceId),
              lt(syncReceipts.clientSeq, highest - RECEIPT_WINDOW),
            ),
          );
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
  async pull(
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<SyncPullResponseWithWatermark> {
    const after = cursor ? Number(cursor) : 0;
    const safeLimit = Math.min(Math.max(limit, 1), 5000);

    /**
     * Has this cursor missed a deletion that no longer exists to be sent?
     *
     * Only asked of a cursor that is actually mid-stream. A first sync (`null`)
     * and an explicit restart from the beginning (`0`) are about to receive
     * everything the account holds, so nothing is missing from them by
     * construction, and answering "resync" to a client that is already
     * resyncing is how that turns into a loop.
     */
    const purgedThrough = after > 0 ? await this.purgeWatermark(userId) : 0;

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

    /**
     * The page itself is unchanged, on purpose.
     *
     * `resyncRequired` says the incremental path between this cursor and now is
     * lossy: a tombstone in that range was purged, so the rows it would have
     * removed can never arrive. The only complete repair is for the client to
     * drop its local database and pull from scratch, which is a decision only
     * the client can make.
     *
     * What the server must not do is act on it unilaterally. Rewinding the
     * cursor to zero here would look helpful and would not be: the resend
     * carries live rows the client already has and still no tombstone for the
     * purged ones, so nothing is repaired, and every page of that resend comes
     * back with a cursor still below the watermark, so the next pull rewinds
     * again and the client never reaches the present.
     *
     * So an old client sees exactly the bytes it saw before plus one key it
     * does not read, which is the only safe thing to send it until 1.2's
     * version envelope exists. A client that does read it should wipe and
     * restart from a null cursor once per sync run, and ignore the flag for the
     * rest of that run: the watermark is a fixed point on the `seq` line, not a
     * per-device fact, so it stays true for every page of the resync it just
     * asked for.
     */
    return {
      changes: changes as SyncPullResponse['changes'],
      cursor: nextCursor,
      hasMore,
      serverTime: Date.now(),
      resyncRequired: after > 0 && after < purgedThrough,
    };
  }

  /**
   * Removes tombstones the whole account has had long enough to see.
   *
   * A tombstone is the only way a delete reaches another device, so it has to
   * outlive every device's cursor, and until now that meant forever: `pull` has
   * no `deletedAt` predicate and nothing deleted one, so a row the user removed
   * two years ago still occupies its `*_sync_idx` entry and is still downloaded
   * in full by every fresh install.
   *
   * **This is not on a timer, and that is the point.** Nothing calls it on a
   * schedule. Its one caller is an authenticated route acting on the caller's
   * own account, so it cannot run behind a user's back, and no shipped client
   * knows the route exists. That restraint is the whole answer to the paragraph
   * below: the machinery is here, tested, and idle until the protocol can carry
   * the one sentence that makes it safe unattended.
   *
   * What a purge costs a device that missed it: the tombstone is gone, so a
   * device whose cursor sits below the watermark never learns the row was
   * deleted. It keeps its local copy, marked `synced`, and nothing will ever
   * push or pull it again. The row is not resurrected on the server or on any
   * other device, but that one device shows a workout the user deleted, and it
   * counts toward that device's volume totals and PR detection. `resyncRequired`
   * is how the server says so, and an old client ignores unknown response keys,
   * so today it is a sentence spoken to nobody.
   *
   * Order is child table before parent, and every candidate parent still
   * referenced by any row is skipped. Both are required, and the second cannot
   * be dropped because of the first: a tombstoned workout whose sets are live,
   * or whose sets were deleted more recently than this horizon, is not
   * removable yet. The `NOT EXISTS` deliberately does not filter by user, since
   * a foreign key does not either: a row belonging to somebody else would block
   * the delete just the same, and finding that out from a constraint violation
   * would abort the sweep instead of skipping one row.
   *
   * `exercises` has no children in that graph, for the reason the schema gives,
   * so a purged custom exercise leaves `exercise_id` values naming a row this
   * database no longer holds. That is already the everyday state of all ~6,800
   * built-ins, and the device keeps its own copy of the exercise, so nothing on
   * a phone reads a dangling reference it was not reading anyway.
   */
  async purgeTombstones(
    userId: string,
    retainForMs: number = DEFAULT_TOMBSTONE_RETENTION_MS,
  ): Promise<TombstoneSweep> {
    const cutoff = Date.now() - Math.max(retainForMs, 0);

    /** Parent wire name to the columns pointing at it, inverted from the schema. */
    const children = new Map<SyncTableName, { table: SyncTableName; column: AnyPgColumn }[]>();

    for (const [child, refs] of Object.entries(SYNC_PARENT_REFS)) {
      for (const ref of refs ?? []) {
        const list = children.get(ref.parent) ?? [];
        list.push({ table: child as SyncTableName, column: ref.column });
        children.set(ref.parent, list);
      }
    }

    const purged: Partial<Record<SyncTableName, number>> = {};
    let removed = 0;
    let receiptsRemoved = 0;
    let highestPurgedSeq = 0;

    await db.transaction(async (tx) => {
      // `SYNCABLE_TABLES` is parent-before-child, so reversed is child-first.
      for (const name of [...SYNCABLE_TABLES].reverse()) {
        const table = SYNC_TABLES[name as SyncTableName];
        if (!table) continue;

        const stillReferenced = (children.get(name as SyncTableName) ?? []).map(
          ({ table: childName, column }) => {
            const child = SYNC_TABLES[childName];
            return notExists(tx.select({ id: child.id }).from(child).where(eq(column, table.id)));
          },
        );

        const rows = await tx
          .delete(table)
          .where(
            and(
              eq(table.userId, userId),
              isNotNull(table.deletedAt),
              lt(table.deletedAt, cutoff),
              ...stillReferenced,
            ),
          )
          .returning({ seq: table.seq });

        if (rows.length === 0) continue;

        purged[name as SyncTableName] = rows.length;
        removed += rows.length;

        for (const row of rows) {
          highestPurgedSeq = Math.max(highestPurgedSeq, Number(row.seq));
        }
      }

      /**
       * Receipts for devices that stopped pushing.
       *
       * The window trimmed on the push path only ever fires for a device that
       * is still pushing. A phone that was replaced leaves its last few thousand
       * receipts behind with nothing to sweep them, so age catches those. Same
       * horizon, and safe for the same reason the window is: a missing receipt
       * means the mutation is applied again and judged on its timestamp, not
       * that it is falsely acknowledged.
       */
      const receipts = await tx
        .delete(syncReceipts)
        .where(
          and(eq(syncReceipts.userId, userId), lt(syncReceipts.appliedAt, new Date(cutoff))),
        )
        .returning({ clientSeq: syncReceipts.clientSeq });

      receiptsRemoved = receipts.length;

      if (highestPurgedSeq > 0) {
        /**
         * `greatest`, not assignment. Two sweeps can remove rows in any order of
         * `seq`: the horizon selects by `deletedAt`, a client-authored wall
         * clock, and a row deleted on a slow phone can carry a lower `deletedAt`
         * and a higher `seq` than one deleted earlier. A watermark that could
         * move backwards would stop reporting a purge it had already made.
         */
        await tx
          .insert(syncPurgeWatermarks)
          .values({ userId, purgedThroughSeq: highestPurgedSeq })
          .onConflictDoUpdate({
            target: syncPurgeWatermarks.userId,
            set: {
              purgedThroughSeq: sql`greatest(${syncPurgeWatermarks.purgedThroughSeq}, ${highestPurgedSeq})`,
              sweptAt: new Date(),
            },
          });
      }
    });

    const watermark = await this.purgeWatermark(userId);

    if (removed > 0 || receiptsRemoved > 0) {
      this.logger.log(
        `Swept ${removed} tombstones and ${receiptsRemoved} receipts, watermark ${watermark}`,
      );
    }

    return { purged, removed, receiptsRemoved, watermark: String(watermark) };
  }

  /** Highest `seq` a sweep has removed for this user. Zero when never swept. */
  private async purgeWatermark(userId: string): Promise<number> {
    const [row] = await db
      .select({ seq: syncPurgeWatermarks.purgedThroughSeq })
      .from(syncPurgeWatermarks)
      .where(eq(syncPurgeWatermarks.userId, userId))
      .limit(1);

    return row ? Number(row.seq) : 0;
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
