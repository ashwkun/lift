/**
 * Sync engine, server side.
 *
 * Two operations: clients push a batch of local mutations, then pull everything
 * that changed since their cursor. Both are scoped to one user and safe to
 * retry.
 */

import {
  shouldOverwrite,
  SYNCABLE_TABLES,
  type Mutation,
  type SyncConflict,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@lift/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, getTableColumns, gt, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { syncReceipts, SYNC_TABLES, type SyncTableName } from '../db/schema.js';

/** Columns the client must never dictate — the server owns these. */
const SERVER_OWNED = new Set(['userId', 'seq']);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  /**
   * Applies a batch of client mutations.
   *
   * Mutations are applied in `clientSeq` order inside a single transaction, so
   * causality is preserved — a set can never land before the workout it belongs
   * to — and a failure part-way leaves nothing half-applied.
   */
  async push(
    userId: string,
    deviceId: string,
    mutations: Mutation[],
  ): Promise<SyncPushResponse> {
    const applied: number[] = [];
    const conflicts: SyncConflict[] = [];

    const ordered = [...mutations].sort((a, b) => a.clientSeq - b.clientSeq);

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

        if (existing && !shouldOverwrite(mutation.updatedAt, Number(existing.updatedAt))) {
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

        try {
          if (mutation.op === 'delete') {
            if (existing) {
              await tx
                .update(table)
                .set({
                  deletedAt: mutation.updatedAt,
                  updatedAt: mutation.updatedAt,
                  seq: sql`nextval('sync_seq')`,
                })
                .where(eq(table.id, mutation.rowId));
            }
            // Deleting a row we've never seen is a no-op, not an error — the
            // client may have created and deleted it while offline.
          } else {
            const values = this.sanitize(table, mutation.payload ?? {}, userId);

            /**
             * Drizzle types inserts per-table, but the target here is picked at
             * runtime from a heterogeneous map, so the row shape is genuinely
             * not inferable. `sanitize()` is the runtime guarantee that only
             * real columns — never `userId` or `seq` — reach this call.
             */
            const writer = tx.insert(table) as unknown as {
              values: (row: Record<string, unknown>) => {
                onConflictDoUpdate: (config: {
                  target: unknown;
                  set: Record<string, unknown>;
                }) => Promise<unknown>;
              };
            };

            await writer.values(values).onConflictDoUpdate({
              target: table.id,
              set: { ...values, seq: sql`nextval('sync_seq')` },
            });
          }

          await tx
            .insert(syncReceipts)
            .values({ userId, deviceId, clientSeq: mutation.clientSeq })
            .onConflictDoNothing();

          applied.push(mutation.clientSeq);
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
        }
      }
    });

    return { applied, conflicts, serverTime: Date.now() };
  }

  /**
   * Returns everything that changed after `cursor`.
   *
   * Because `seq` is a single global sequence, the merged result can be cut at
   * any point and the cursor advanced to that row's seq — the next page resumes
   * exactly where this one stopped, with no gap and no repeat.
   */
  async pull(userId: string, cursor: string | null, limit: number): Promise<SyncPullResponse> {
    const after = cursor ? Number(cursor) : 0;
    const safeLimit = Math.min(Math.max(limit, 1), 5000);

    const collected: { table: SyncTableName; seq: number; row: Record<string, unknown> }[] = [];

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
    const hasMore = collected.length > safeLimit;

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
  ): Record<string, unknown> {
    const columns = getTableColumns(table);
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (!(key in columns)) continue;
      if (SERVER_OWNED.has(key)) continue;
      values[key] = value;
    }

    values.userId = userId;
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
