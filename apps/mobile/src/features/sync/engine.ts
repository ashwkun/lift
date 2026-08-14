/**
 * Client sync engine.
 *
 * Push first, then pull. That order matters: pushing first means the server has
 * already seen our local edits when we ask what changed, so a freshly-pushed
 * row comes back as a confirmation rather than arriving later and appearing to
 * be a remote change we need to merge.
 */

import {
  uuidv7,
  type Mutation,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncableTable,
} from '@ironlog/shared';
import { asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { SYNC_TABLE_MAP, syncMeta, syncOplog } from '@/db/schema';

import { apiFetch, SyncHttpError } from './auth-client';

const CURSOR_KEY = 'pull_cursor';
const DEVICE_KEY = 'device_id';

/** Mutations per push request. Large enough to be efficient, small enough that
 *  a failure doesn't discard much work. */
const PUSH_BATCH = 500;
const PULL_LIMIT = 1000;

/** Give up on a mutation the server keeps rejecting rather than looping forever. */
const MAX_ATTEMPTS = 5;

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  quarantined: number;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

async function readMeta(key: string): Promise<string | null> {
  const [row] = await db.select().from(syncMeta).where(eq(syncMeta.key, key)).limit(1);
  return row?.value ?? null;
}

async function writeMeta(key: string, value: string): Promise<void> {
  await db
    .insert(syncMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value } });
}

/**
 * Stable per-install identifier.
 *
 * The server keys push idempotency on (user, device, clientSeq), so this must
 * survive restarts — a device that regenerated its id on every launch would
 * re-apply mutations it had already pushed.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await readMeta(DEVICE_KEY);
  if (existing) return existing;

  const created = uuidv7();
  await writeMeta(DEVICE_KEY, created);
  return created;
}

// ---------------------------------------------------------------------------
// Timestamp handling
// ---------------------------------------------------------------------------

/**
 * Columns stored as Drizzle `timestamp_ms`, which surface as `Date` locally but
 * travel as epoch-ms numbers on the wire.
 */
const DATE_COLUMNS = new Set([
  'startedAt',
  'finishedAt',
  'completedAt',
  'achievedAt',
  'measuredAt',
  'lastPerformedAt',
]);

function toLocalRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (DATE_COLUMNS.has(key) && (typeof value === 'number' || typeof value === 'string')) {
      const date = new Date(value);
      result[key] = Number.isNaN(date.getTime()) ? null : date;
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function pushPending(deviceId: string): Promise<{
  pushed: number;
  conflicts: number;
  quarantined: number;
}> {
  let pushed = 0;
  let conflicts = 0;
  let quarantined = 0;

  for (;;) {
    const entries = await db
      .select()
      .from(syncOplog)
      // Ascending seq preserves causality — parents were logged before children.
      .orderBy(asc(syncOplog.seq))
      .limit(PUSH_BATCH);

    if (entries.length === 0) break;

    const mutations: Mutation[] = entries.map((entry) => ({
      clientSeq: entry.seq,
      table: entry.tableName as SyncableTable,
      rowId: entry.rowId,
      op: entry.op,
      payload: entry.payload ? (JSON.parse(entry.payload) as Record<string, unknown>) : null,
      updatedAt: entry.updatedAt,
    }));

    const response = await apiFetch<SyncPushResponse>('/api/sync/push', {
      mutations,
      deviceId,
    });

    // Applied entries are done with — drop them from the log.
    if (response.applied.length > 0) {
      await db.delete(syncOplog).where(inArray(syncOplog.seq, response.applied));
      pushed += response.applied.length;
    }

    for (const conflict of response.conflicts) {
      conflicts += 1;

      const table = SYNC_TABLE_MAP[conflict.table as keyof typeof SYNC_TABLE_MAP];

      if (conflict.reason === 'stale' && conflict.serverRow && table) {
        // The server's copy won. Overwrite ours so the two agree, and mark it
        // synced so we don't immediately try to push it back.
        const values = toLocalRow({ ...conflict.serverRow, syncState: 'synced' });
        await db
          .insert(table)
          .values(values as never)
          .onConflictDoUpdate({ target: table.id, set: values as never });
      }

      // Whatever the reason, this mutation will never succeed as written.
      await db.delete(syncOplog).where(eq(syncOplog.seq, conflict.clientSeq));

      if (conflict.reason === 'invalid' || conflict.reason === 'forbidden') quarantined += 1;
    }

    // Nothing moved — the batch is wedged. Stop rather than spin.
    if (response.applied.length === 0 && response.conflicts.length === 0) {
      await recordFailedAttempts(entries.map((entry) => entry.seq));
      break;
    }
  }

  return { pushed, conflicts, quarantined };
}

/**
 * Increments the retry counter and drops entries that have failed too often.
 * Without this, one permanently-rejected mutation blocks the whole queue.
 */
async function recordFailedAttempts(seqs: number[]): Promise<void> {
  for (const seq of seqs) {
    const [entry] = await db.select().from(syncOplog).where(eq(syncOplog.seq, seq)).limit(1);
    if (!entry) continue;

    const attempts = entry.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db.delete(syncOplog).where(eq(syncOplog.seq, seq));
    } else {
      await db.update(syncOplog).set({ attempts }).where(eq(syncOplog.seq, seq));
    }
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pullChanges(): Promise<number> {
  let cursor = await readMeta(CURSOR_KEY);
  let applied = 0;

  for (;;) {
    const response = await apiFetch<SyncPullResponse>('/api/sync/pull', {
      cursor,
      limit: PULL_LIMIT,
    });

    for (const [name, rows] of Object.entries(response.changes ?? {})) {
      const table = SYNC_TABLE_MAP[name as keyof typeof SYNC_TABLE_MAP];
      if (!table || !Array.isArray(rows)) continue;

      for (const row of rows) {
        const values = toLocalRow({
          ...(row as Record<string, unknown>),
          // Rows arriving from the server are by definition already synced.
          // Marking them 'pending' would push them straight back.
          syncState: 'synced',
        });

        await db
          .insert(table)
          .values(values as never)
          .onConflictDoUpdate({ target: table.id, set: values as never });

        applied += 1;
      }
    }

    cursor = response.cursor;
    // Persist after every page so an interrupted sync resumes rather than
    // restarting from the beginning.
    await writeMeta(CURSOR_KEY, cursor);

    if (!response.hasMore) break;
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let inFlight: Promise<SyncResult> | null = null;

/**
 * Runs a full sync cycle.
 *
 * Concurrent calls share one run — the app triggers sync on focus, on network
 * regain and after finishing a workout, and those can easily coincide.
 */
export function runSync(): Promise<SyncResult> {
  inFlight ??= execute().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function execute(): Promise<SyncResult> {
  const deviceId = await getDeviceId();

  const { pushed, conflicts, quarantined } = await pushPending(deviceId);
  const pulled = await pullChanges();

  return { pushed, pulled, conflicts, quarantined };
}

/** Count of local changes not yet accepted by the server. */
export async function pendingCount(): Promise<number> {
  const rows = await db.select({ seq: syncOplog.seq }).from(syncOplog);
  return rows.length;
}

/**
 * Clears all sync state.
 *
 * Called on sign-out: the cursor and device id belong to the previous account,
 * and reusing them would make the next user's first pull start mid-stream.
 */
export async function resetSyncState(): Promise<void> {
  await db.delete(syncOplog);
  await db.delete(syncMeta).where(eq(syncMeta.key, CURSOR_KEY));
}

export { SyncHttpError };
