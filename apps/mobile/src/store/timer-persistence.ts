/**
 * Keeps the rest period on disk so it outlives the process.
 *
 * A scheduled notification survives the app being killed; the countdown behind
 * it did not. Coming back to a bell for a timer the app has forgotten: with no
 * bar, no remaining time and no way to skip it. Is the worst version of that
 * moment. Because the period is stored as an absolute deadline (see the
 * docstring in `./timer`), all it takes is writing the numbers down.
 *
 * It goes into the existing `settings` key/value table under its own key rather
 * than through Zustand's `persist` middleware. That middleware rehydrates
 * asynchronously, which means the first frame paints with an idle timer and the
 * bar drops in a moment later: the same ~90pt jump under a moving thumb the
 * rest of this work is trying to remove. Reading it in `Bootstrap` behind the
 * splash costs one query and lands the bar in the first frame it belongs in.
 */

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { settings as settingsTable } from '@/db/schema';

import { type RestFields, type RestKind, useTimer } from './timer';

const REST_KEY = 'rest_timer';

let unsubscribe: (() => void) | null = null;
let lastWritten: string | null = null;

/**
 * Reads the stored rest period back into the timer store.
 *
 * Contract for the caller: `await` this inside `Bootstrap` before the splash
 * lifts, after migrations have run (it queries a table) and alongside the
 * settings hydrate. It never throws and never rejects. An unreadable row means
 * no rest timer, which is the same state a fresh install is in, so it needs no
 * try/catch of its own at the call site. It also attaches the writer, so
 * calling it is enough on its own; `subscribeRestPersistence` is only needed if
 * the writer should outlive a caller that wants to detach it.
 */
export async function loadPersistedRest(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, REST_KEY))
      .limit(1);

    const stored = row?.value ? parseRest(row.value) : null;
    if (stored) useTimer.getState().restoreRest(stored);
  } catch {
    // A corrupt or unreadable row leaves the timer idle, which is where it
    // would have started anyway. Never block launch on a rest period.
  }

  subscribeRestPersistence();
}

/**
 * Starts mirroring every change to the rest period onto disk.
 *
 * Idempotent, and returns the unsubscribe. `loadPersistedRest` already calls
 * it; this export exists for the case where the writer has to be torn down.
 * The store only ever changes when the user starts, adjusts, pauses, resumes or
 * ends a rest. The 1Hz countdown is derived at read time and writes nothing,
 * so this is a handful of rows per session, not one a second.
 */
export function subscribeRestPersistence(): () => void {
  if (unsubscribe) return unsubscribe;

  unsubscribe = useTimer.subscribe((state) => {
    void persist(selectRest(state));
  });

  return unsubscribe;
}

function selectRest(state: RestFields): RestFields {
  return {
    restEndsAt: state.restEndsAt,
    restPausedSeconds: state.restPausedSeconds,
    restTotalSeconds: state.restTotalSeconds,
    restSourceSetId: state.restSourceSetId,
    restExerciseId: state.restExerciseId,
    restExerciseName: state.restExerciseName,
    restKind: state.restKind,
  };
}

async function persist(fields: RestFields): Promise<void> {
  const value = JSON.stringify(fields);
  if (value === lastWritten) return;
  lastWritten = value;

  try {
    await db
      .insert(settingsTable)
      .values({ key: REST_KEY, value, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value, updatedAt: Date.now() },
      });
  } catch {
    // Losing the mirror costs a rest period across a kill, which is not worth
    // interrupting a set over. The next change writes the whole state again.
    lastWritten = null;
  }
}

/**
 * Reads back defensively: the row is JSON we wrote, but a half-migrated or
 * hand-edited database should degrade to "no rest" rather than to a timer
 * counting down from `NaN`.
 */
function parseRest(value: string): RestFields | null {
  let stored: unknown;

  try {
    stored = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof stored !== 'object' || stored === null) return null;
  const row = stored as Record<string, unknown>;

  // A zero span is the idle state written back out, not a rest period.
  const total = finiteOrNull(row.restTotalSeconds) ?? 0;
  if (total <= 0) return null;

  return {
    restEndsAt: finiteOrNull(row.restEndsAt),
    restPausedSeconds: finiteOrNull(row.restPausedSeconds),
    restTotalSeconds: total,
    restSourceSetId: stringOrNull(row.restSourceSetId),
    restExerciseId: stringOrNull(row.restExerciseId),
    restExerciseName: stringOrNull(row.restExerciseName),
    restKind: restKindOrNull(row.restKind),
  };
}

function restKindOrNull(value: unknown): RestKind | null {
  if (typeof value !== 'string') return null;
  return value === 'working' || value === 'warmup' ? value : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
