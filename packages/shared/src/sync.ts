/**
 * Sync wire protocol: the contract between the on-device SQLite database and
 * the API.
 *
 * Design notes that matter:
 *
 * 1. **Client-generated UUIDv7 primary keys.** Creating a workout offline must
 *    never wait for a server round-trip to learn its own ID.
 *
 * 2. **Soft deletes only.** A hard DELETE is invisible to other devices. They
 *    have no way to learn the row is gone. Every delete sets `deletedAt` and the
 *    tombstone replicates like any other change.
 *
 * 3. **The pull cursor is a monotonic server sequence, not a timestamp.** Wall
 *    clocks skew, and two rows written in the same millisecond would let a
 *    `WHERE updated_at > cursor` query silently skip one. The server assigns a
 *    strictly increasing `seq` on write and paginates by it.
 *
 * 4. **Last-write-wins, per row.** Workouts belong to exactly one user and are
 *    rarely edited from two devices at once. CRDTs would buy nothing here at a
 *    large cost in complexity.
 */

import { z } from 'zod';

/** Tables that participate in sync, in dependency order: parents before children. */
export const SYNCABLE_TABLES = [
  'exercises',
  'routine_folders',
  'routines',
  'routine_exercises',
  'routine_sets',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'personal_records',
  'body_measurements',
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

export const syncableTableSchema = z.enum(SYNCABLE_TABLES);

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export const mutationSchema = z.object({
  /** Client-side oplog id, echoed back so the client can retire the entry. */
  clientSeq: z.number().int().nonnegative(),
  table: syncableTableSchema,
  rowId: z.string().uuid(),
  op: z.enum(['upsert', 'delete']),
  /** Full row for upserts (not a patch. Simpler, and rows are tiny). */
  payload: z.record(z.string(), z.unknown()).nullable(),
  /** Client's updatedAt for the row, epoch ms. Used for LWW comparison. */
  updatedAt: z.number().int(),
});

export type Mutation = z.infer<typeof mutationSchema>;

export const syncPushRequestSchema = z.object({
  /** Batched so a long offline stretch doesn't become hundreds of requests. */
  mutations: z.array(mutationSchema).max(1000),
  deviceId: z.string(),
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncConflictSchema = z.object({
  clientSeq: z.number().int(),
  rowId: z.string().uuid(),
  table: syncableTableSchema,
  reason: z.enum(['stale', 'forbidden', 'invalid', 'missing_parent']),
  /** Winning server row, so the client can overwrite its local copy. */
  serverRow: z.record(z.string(), z.unknown()).nullable(),
});

export type SyncConflict = z.infer<typeof syncConflictSchema>;

export const syncPushResponseSchema = z.object({
  /** clientSeq values that were applied and can be dropped from the oplog. */
  applied: z.array(z.number().int()),
  conflicts: z.array(syncConflictSchema),
  serverTime: z.number().int(),
});

export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

export const syncPullRequestSchema = z.object({
  /** Opaque monotonic cursor from the previous pull; null for a first sync. */
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(5000).default(1000),
});

export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

export const syncPullResponseSchema = z.object({
  /** Changed rows keyed by table, already ordered parents-before-children. */
  changes: z.record(syncableTableSchema, z.array(z.record(z.string(), z.unknown()))),
  cursor: z.string(),
  /** True when more pages remain. The client should immediately pull again. */
  hasMore: z.boolean(),
  serverTime: z.number().int(),
});

export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Decides whether an incoming write should overwrite the row already stored.
 *
 * Ties go to the **existing** row. Equal timestamps mean we genuinely cannot
 * order the two writes, and preferring the incumbent makes the operation
 * idempotent: replaying the same mutation twice can't flip state back and forth.
 */
export function shouldOverwrite(incomingUpdatedAt: number, existingUpdatedAt: number): boolean {
  return incomingUpdatedAt > existingUpdatedAt;
}

/**
 * How far ahead of the server a client's clock is allowed to run.
 *
 * Generous on purpose. A phone a few minutes fast is ordinary, and clamping an
 * honest write would make that device lose every conflict instead of winning
 * the ones it should. What this bounds is the pathological case: a clock set to
 * next year.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Bounds a client-authored `updatedAt` to something the server can believe.
 *
 * Last-write-wins is only as trustworthy as the clocks feeding it, and
 * `updatedAt` arrives as an unbounded integer from a device whose clock the
 * user can set. A row stamped a year into the future wins every comparison
 * forever: every honest later edit comes back `stale`, and the client's
 * response to `stale` is to overwrite its local copy and drop the oplog entry,
 * so the user's edit is destroyed with no error and nothing left to retry. One
 * wrong clock is enough, because `touch()` stamps every local write.
 *
 * Clamping rather than rejecting is deliberate. A skewed device is still
 * holding the only copy of that training data, so the write must land; it just
 * must not land in the future. The clamped value is what gets compared *and*
 * what gets stored, because storing the raw value while comparing the clamped
 * one would reintroduce the bug on the next write.
 */
export function clampUpdatedAt(clientUpdatedAt: number, serverNow: number): number {
  return Math.min(clientUpdatedAt, serverNow + CLOCK_SKEW_TOLERANCE_MS);
}

/** Rows every syncable table carries. */
export interface SyncMetadata {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/** Local-only column tracking whether a row still needs pushing. */
export const SYNC_STATES = ['synced', 'pending', 'conflict'] as const;
export type SyncState = (typeof SYNC_STATES)[number];
