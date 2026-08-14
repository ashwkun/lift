/**
 * Write-tracking helpers.
 *
 * Every local change to a syncable table must do two things atomically: stamp
 * `updatedAt` on the row, and append an entry to `sync_oplog`. If a write skips
 * the oplog it becomes invisible to the sync engine and silently never reaches
 * the server — so repositories go through these helpers rather than calling
 * `db.insert` directly.
 */

import type { SyncableTable } from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from './client';
import { syncOplog } from './schema';

/** Timestamp + sync-state stamp applied to every tracked write. */
export function touch(): { updatedAt: number; syncState: 'pending' } {
  return { updatedAt: Date.now(), syncState: 'pending' };
}

interface TrackedRow {
  id: string;
  updatedAt: number;
  [key: string]: unknown;
}

/**
 * Records a create/update. `row` should be the full post-write row — the server
 * applies whole rows rather than patches, which keeps conflict resolution to a
 * single timestamp comparison.
 */
export async function trackUpsert(table: SyncableTable, row: TrackedRow): Promise<void> {
  // `syncState` is device-local bookkeeping and must not travel to the server.
  const { syncState: _ignored, ...payload } = row;

  await db.insert(syncOplog).values({
    tableName: table,
    rowId: row.id,
    op: 'upsert',
    payload: JSON.stringify(payload),
    updatedAt: row.updatedAt,
  });
}

export async function trackDelete(
  table: SyncableTable,
  rowId: string,
  updatedAt: number,
): Promise<void> {
  await db.insert(syncOplog).values({
    tableName: table,
    rowId,
    op: 'delete',
    payload: null,
    updatedAt,
  });
}

/**
 * Collapses redundant oplog entries for a row before appending a new one.
 *
 * Editing a set's weight five times while it's still offline produces five
 * entries that all resolve to the same final state. Since the server applies
 * whole rows, only the last one matters — dropping the rest keeps the push
 * payload small after a long offline stretch.
 */
export async function trackUpsertCoalesced(table: SyncableTable, row: TrackedRow): Promise<void> {
  await db
    .delete(syncOplog)
    .where(and(eq(syncOplog.tableName, table), eq(syncOplog.rowId, row.id), eq(syncOplog.op, 'upsert')));

  await trackUpsert(table, row);
}

/** Rows still awaiting a successful push. */
export async function pendingMutationCount(): Promise<number> {
  const rows = await db.select({ seq: syncOplog.seq }).from(syncOplog);
  return rows.length;
}

/** Standard predicate for "not soft-deleted", used by every read query. */
export function notDeleted<T extends { deletedAt: unknown }>(table: T) {
  return isNull(table.deletedAt as Parameters<typeof isNull>[0]);
}
