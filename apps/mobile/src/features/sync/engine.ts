/**
 * Client sync engine.
 *
 * Push first, then pull. That order matters: pushing first means the server has
 * already seen our local edits when we ask what changed, so a freshly-pushed
 * row comes back as a confirmation rather than arriving later and appearing to
 * be a remote change we need to merge.
 */

import {
  SYNCABLE_TABLES,
  uuidv7,
  type Mutation,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncableTable,
} from '@lift/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { SYNC_TABLE_MAP, syncMeta, syncOplog } from '@/db/schema';

import { apiFetch, SyncHttpError } from './auth-client';

const CURSOR_KEY = 'pull_cursor';
const DEVICE_KEY = 'device_id';

/** Mutations per push request. Large enough to be efficient, small enough that
 *  a failure doesn't discard much work. */
const PUSH_BATCH = 500;
const PULL_LIMIT = 1000;

/**
 * Stop sending a mutation the server keeps rejecting, so it can't block the
 * queue behind it forever. The entry is kept, not deleted: see
 * `recordFailedAttempt`.
 */
const MAX_ATTEMPTS = 5;

/**
 * How many retired entries the log keeps.
 *
 * Retiring without deleting is what stops a permanent failure from being
 * reported as success, but an unbounded log is its own failure: a server that
 * rejects everything would grow the table for as long as the app is installed.
 * Past this many, the oldest retired entries are dropped. The card reads the
 * count at the cap as a floor rather than a total, so nothing is claimed to be
 * smaller than it was.
 */
export const RETIRED_LIMIT = 500;

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Mutations retired this run: the server will never accept them as written. */
  quarantined: number;
  /**
   * Rows the pull could not store, and left for a later run.
   *
   * Almost always a foreign key: a row referencing a built-in exercise this
   * build's catalog does not contain. See `pullChanges`.
   */
  deferred: number;
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
 * survive restarts: a device that regenerated its id on every launch would
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
      // Retired entries stay in the table so the UI can count what did not
      // sync, but sending them again would wedge the queue behind them.
      .where(lt(syncOplog.attempts, MAX_ATTEMPTS))
      // Ascending seq preserves causality. Parents were logged before children.
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

    let response: SyncPushResponse;
    try {
      response = await apiFetch<SyncPushResponse>('/api/sync/push', {
        mutations,
        deviceId,
      });
    } catch (error) {
      /**
       * A 400 has to cost the head entry an attempt before it propagates.
       *
       * Every other way this batch can fail eventually retires something: a
       * conflict retires the entry it names, and a response that decides
       * nothing charges the head below. A thrown error charged nothing, so
       * `attempts` stayed at zero, MAX_ATTEMPTS was never reached, and a batch
       * the server will not parse was re-sent on every sync forever with the
       * whole queue stuck behind it. The head is the one to charge for the same
       * reason it is below: mutations go up in causal order, so it is the one
       * that can be holding the others up.
       *
       * Only 400, and deliberately not 5xx.
       *
       * A 400 is the request envelope failing validation. That is decided for
       * the whole request before any mutation is looked at, so no per-mutation
       * conflict can come back and nothing else here can ever retire it. It is
       * also deterministic: retrying the same bytes gets the same answer, so
       * the attempts are not being spent on bad luck.
       *
       * A 5xx says the server broke, not that this row is bad, which is the
       * same thing a transport failure says and that is exempt by construction
       * (it does not throw a `SyncHttpError` at all). Charging it would mean a
       * Postgres restart, a failed deploy or five minutes of 502s from a proxy
       * quietly retiring five perfectly good mutations, and a retired entry
       * stops being sent: the workout stays on the phone and never reaches the
       * account. The case that argued for charging 5xx, a single payload the
       * schema refuses taking the batch down with it, is now answered by the
       * server instead. Each mutation runs in its own savepoint, so a bad row
       * comes back as an `invalid` conflict and is retired by the loop below
       * rather than becoming a 500 at all.
       */
      const head = entries[0];
      if (error instanceof SyncHttpError && error.status === 400 && head) {
        await recordFailedAttempt([head.seq], 'The server could not read this change.');
      }
      throw error;
    }

    // Applied entries are done with. Drop them from the log.
    if (response.applied.length > 0) {
      await db.delete(syncOplog).where(inArray(syncOplog.seq, response.applied));
      pushed += response.applied.length;
    }

    // Entries the server actually decided something about. An entry it simply
    // didn't get to is neither applied nor rejected, and must stay untouched.
    let resolved = response.applied.length;

    for (const conflict of response.conflicts) {
      conflicts += 1;

      const table = SYNC_TABLE_MAP[conflict.table as keyof typeof SYNC_TABLE_MAP];

      if (conflict.reason === 'missing_parent') {
        // Retryable, not fatal: the parent may be later in this queue, or on a
        // device that hasn't pushed yet. Charge an attempt and leave it.
        await recordFailedAttempt(
          [conflict.clientSeq],
          'The server has not seen the row this one belongs to yet.',
        );
        continue;
      }

      if (conflict.reason === 'stale') {
        if (conflict.serverRow && table) {
          // The server's copy won. Overwrite ours so the two agree, and mark it
          // synced so we don't immediately try to push it back.
          const values = toLocalRow({
            ...conflict.serverRow,
            syncState: 'synced',
          });

          try {
            await db
              .insert(table)
              .values(values as never)
              .onConflictDoUpdate({ target: table.id, set: values as never });
          } catch (error) {
            /*
             * The same exposure the pull had, and it has to be handled here
             * too: this is a server row landing outside the ordering that
             * `pullChanges` relies on, so it can reference a parent this device
             * does not have. Uncaught it killed the whole push, which also
             * stranded every unrelated mutation queued behind it.
             *
             * Charged as an attempt rather than retired. The oplog entry is
             * deliberately left in place: deleting it below would drop our edit
             * while the server's replacement failed to store, leaving the row
             * at neither version.
             */
            await recordFailedAttempt(
              [conflict.clientSeq],
              'This device could not store the server\u2019s version of this row.',
            );
            console.warn(
              `[sync] could not store server row ${conflict.table}/${String(
                conflict.serverRow.id ?? '?',
              )}: ${messageOf(error)}`,
            );
            continue;
          }
        }

        // Our edit lost the timestamp comparison and the winner is now stored
        // locally, so the mutation has nothing left to say.
        await db.delete(syncOplog).where(eq(syncOplog.seq, conflict.clientSeq));
        resolved += 1;
        continue;
      }

      // invalid / forbidden: the server will never accept this row as written.
      // Retire it rather than delete it, so the count of changes that did not
      // sync survives until the user is told about it.
      await retireEntries(
        [conflict.clientSeq],
        conflict.reason === 'forbidden'
          ? 'The server refused this change.'
          : 'The server could not read this change.',
      );
      resolved += 1;
      quarantined += 1;
    }

    if (resolved === 0) {
      /**
       * The queue didn't shrink, so looping would replay the same request.
       *
       * If the server said nothing at all about the batch, charge the attempt
       * to the oldest entry and only that one: mutations are pushed in causal
       * order, so the head is the one that can be holding the rest up, and the
       * old behaviour (an attempt against every entry in the batch) spent all
       * five lives of 500 unrelated mutations on a single bad response.
       */
      const head = entries[0];
      if (response.conflicts.length === 0 && head) {
        await recordFailedAttempt([head.seq], 'The server accepted nothing from this batch.');
      }
      break;
    }
  }

  return { pushed, conflicts, quarantined };
}

/**
 * Charges one failed attempt, with the reason, against each entry.
 *
 * Entries are never deleted here. Once `attempts` reaches `MAX_ATTEMPTS` the
 * entry stops being sent, but it stays in the log: deleting it, which is what
 * this used to do. Turned a permanent sync failure into silent divergence that
 * the sync card then reported as "All changes synced".
 */
async function recordFailedAttempt(seqs: number[], reason: string): Promise<void> {
  if (seqs.length === 0) return;

  await db
    .update(syncOplog)
    .set({ attempts: sql`${syncOplog.attempts} + 1`, lastError: reason })
    .where(inArray(syncOplog.seq, seqs));
}

/** Marks entries as never-to-be-sent-again without waiting out the retries. */
async function retireEntries(seqs: number[], reason: string): Promise<void> {
  if (seqs.length === 0) return;

  await db
    .update(syncOplog)
    .set({ attempts: MAX_ATTEMPTS, lastError: reason })
    .where(inArray(syncOplog.seq, seqs));
}

/**
 * Puts retired entries back in the queue.
 *
 * A retirement is a statement about the server's answer at the time, not about
 * the change itself: a schema fix, a re-auth or a corrected clock can make the
 * same rows acceptable. This is the user's way out, and it deletes nothing:
 * entries that fail again simply retire again.
 */
export async function retryRejected(): Promise<void> {
  await db
    .update(syncOplog)
    .set({ attempts: 0, lastError: null })
    .where(gte(syncOplog.attempts, MAX_ATTEMPTS));
}

/**
 * Drops retired entries past `RETIRED_LIMIT`, oldest first.
 *
 * Reading the cutoff seq and deleting below it keeps this to two small
 * statements and touches nothing that is still being sent: entries under
 * `MAX_ATTEMPTS` are excluded from both halves regardless of age.
 */
async function sweepRetired(): Promise<void> {
  const [cutoff] = await db
    .select({ seq: syncOplog.seq })
    .from(syncOplog)
    .where(gte(syncOplog.attempts, MAX_ATTEMPTS))
    .orderBy(desc(syncOplog.seq))
    .limit(1)
    .offset(RETIRED_LIMIT - 1);

  if (!cutoff) return;

  await db
    .delete(syncOplog)
    .where(and(gte(syncOplog.attempts, MAX_ATTEMPTS), lt(syncOplog.seq, cutoff.seq)));
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Collects every page, then applies them parent table first.
 *
 * Both halves of that are load-bearing, and the reason is a foreign key.
 *
 * `seq` is a single global sequence that is *bumped on update*, so a row can
 * sort behind its own children: edit a workout after logging its sets and the
 * workout's seq moves past them. The server pages strictly by seq
 * (`sync.service.ts`), and builds each page's `changes` keyed in the order rows
 * are met, so a child table can both precede its parent within a page and land
 * a whole page ahead of it. With `PRAGMA foreign_keys = ON` (see `db/client`)
 * that insert raises `FOREIGN KEY constraint failed`, which is why this used to
 * die partway through a large first sync.
 *
 * Applying in `SYNCABLE_TABLES` order fixes it, because that list is already
 * parent-before-child and no syncable table references itself. Doing it across
 * the *whole* pull rather than per page is what handles the parent being on a
 * later page. Sorting within a page leaves that case failing exactly as before.
 *
 * There is deliberately no transaction around this. expo-sqlite's
 * `withTransactionAsync` is documented as non-exclusive, so a set logged while
 * a sync ran would be swept into it and rolled back with it on failure, and
 * `withExclusiveTransactionAsync` runs on a separate connection this `db` does
 * not write through. Neither is worth risking a logged set for: every write
 * here is an idempotent upsert, and the cursor only advances once they all
 * land, so an interrupted pull is re-applied rather than half-kept.
 *
 * ## One bad row no longer stops the pull
 *
 * Ordering fixes the foreign keys this engine can satisfy. It cannot fix the
 * one it can't: built-in exercises are keyed by slug and never cross the wire
 * (`mutationSchema.rowId` is a uuid), so they exist locally only because
 * `db/seed.ts` put them there. A `workout_exercises` row naming a built-in this
 * build's catalog does not contain has no parent to wait for, and no later page
 * will bring one.
 *
 * That happened. e82c1f1 cut 6,108 rows out of the catalog, and every device
 * that pulled a history referencing one of them raised `FOREIGN KEY constraint
 * failed` on the first such row, abandoned the entire pull, and did it again on
 * every retry, because the cursor advances only after the whole batch lands.
 * The user saw "This device could not store the changes" and no data, forever,
 * with nothing naming the row or the table. Restoring the catalog fixed that
 * instance. This is the part that stops the next one being as bad.
 *
 * So a row that will not store is now recorded and stepped over rather than
 * thrown. The rest of the pull lands, which is the difference between a device
 * that is missing a handful of sets and one that is missing everything.
 *
 * **The cursor stays put whenever anything was deferred**, and that is the
 * whole safety of it. Advancing past a skipped row would be silent data loss:
 * the server pages strictly forward by seq, so nothing would ever offer that
 * row again. Pinned, the next run re-pulls and re-applies. Every write here is
 * an idempotent upsert so the repeat costs bandwidth and nothing else, and the
 * moment a build ships the missing catalog row it resolves on its own.
 *
 * The deferrals are logged with their table and id, because the failure this
 * exists for took a phone on a cable to identify.
 */
async function pullChanges(): Promise<{ applied: number; deferred: number }> {
  let cursor = await readMeta(CURSOR_KEY);
  const collected = new Map<string, Record<string, unknown>[]>();

  for (;;) {
    const response = await apiFetch<SyncPullResponse>('/api/sync/pull', {
      cursor,
      limit: PULL_LIMIT,
    });

    for (const [name, rows] of Object.entries(response.changes ?? {})) {
      if (!Array.isArray(rows)) continue;

      const existing = collected.get(name);
      if (existing) existing.push(...rows);
      else collected.set(name, [...rows]);
    }

    cursor = response.cursor;

    if (!response.hasMore) break;
  }

  let applied = 0;
  const deferrals: string[] = [];

  for (const name of SYNCABLE_TABLES) {
    const table = SYNC_TABLE_MAP[name as keyof typeof SYNC_TABLE_MAP];
    const rows = collected.get(name);
    if (!table || !rows) continue;

    for (const row of rows) {
      const values = toLocalRow({
        ...row,
        // Rows arriving from the server are by definition already synced.
        // Marking them 'pending' would push them straight back.
        syncState: 'synced',
      });

      try {
        await db
          .insert(table)
          .values(values as never)
          .onConflictDoUpdate({ target: table.id, set: values as never });

        applied += 1;
      } catch (error) {
        // Only the row is abandoned, and only for this run. See the note above
        // for why the cursor then refuses to move.
        deferrals.push(`${name}/${String(row.id ?? '?')}: ${messageOf(error)}`);
      }
    }
  }

  if (deferrals.length > 0) {
    /*
     * Logged in full, and at most ten of them.
     *
     * The whole reason this branch exists is that the failure it handles was
     * unidentifiable from the app: one line saying the device could not store
     * the changes, with no table and no id. A device missing one catalog row
     * can defer thousands of rows that all say the same thing, so the list is
     * capped and the total is stated separately rather than the log being
     * filled with one repeated sentence.
     */
    console.warn(
      `[sync] deferred ${deferrals.length} row(s) to a later run; the cursor stays at the previous position:\n` +
        deferrals.slice(0, 10).join('\n') +
        (deferrals.length > 10 ? `\n...and ${deferrals.length - 10} more` : ''),
    );
  }

  /*
   * Advanced only once every row is in, which now means every row *including*
   * the deferred ones. Persisting it per page, which is what this did, would
   * strand the rest of the pull behind a cursor that claimed it had already
   * been applied, and advancing it over a deferral would do the same to that
   * row permanently.
   */
  if (cursor !== null && deferrals.length === 0) await writeMeta(CURSOR_KEY, cursor);

  return { applied, deferred: deferrals.length };
}

/** SQLite rejects with a plain `Error`, so the message is all there is. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let inFlight: Promise<SyncResult> | null = null;

/**
 * Runs a full sync cycle.
 *
 * Concurrent calls share one run. The app triggers sync on focus, on network
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
  await sweepRetired();
  const { applied: pulled, deferred } = await pullChanges();

  return { pushed, pulled, conflicts, quarantined, deferred };
}

export interface OutboxState {
  /** Local changes still on their way to the server. */
  pending: number;
  /** Local changes that ran out of attempts. They are not sent again unless the
   *  user asks for it: see `retryRejected`. */
  rejected: number;
  /** Why the most recent rejection happened, for the one line the UI has. */
  rejectionReason: string | null;
}

/**
 * The state of the outbound queue.
 *
 * `pending` and `rejected` are counted separately because they mean opposite
 * things to the user: one resolves itself, the other never will unless they do
 * something. Collapsing them into a single "pending" number is what let the app
 * claim everything was synced while rows sat permanently stuck.
 */
export async function readOutbox(): Promise<OutboxState> {
  // Counted in SQL rather than in JS: this runs whenever the profile tab is
  // focused, and a long offline backlog is exactly when materialising the whole
  // table would cost the most. `coalesce` because `sum()` answers null on an
  // empty table.
  const [totals] = await db
    .select({
      pending: sql<number>`coalesce(sum(case when ${syncOplog.attempts} < ${MAX_ATTEMPTS} then 1 else 0 end), 0)`,
      rejected: sql<number>`coalesce(sum(case when ${syncOplog.attempts} >= ${MAX_ATTEMPTS} then 1 else 0 end), 0)`,
    })
    .from(syncOplog);

  // Scoped to retired rows on purpose: a merely-pending entry that took one
  // failed attempt also carries a `lastError`, and that text would then be
  // shown as the reason changes "could not sync" when nothing has been given up
  // on yet.
  const [reason] = await db
    .select({ lastError: syncOplog.lastError })
    .from(syncOplog)
    .where(and(gte(syncOplog.attempts, MAX_ATTEMPTS), isNotNull(syncOplog.lastError)))
    .orderBy(desc(syncOplog.seq))
    .limit(1);

  return {
    pending: totals?.pending ?? 0,
    rejected: totals?.rejected ?? 0,
    rejectionReason: reason?.lastError ?? null,
  };
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
