/**
 * Exercise library reads and writes.
 */

import { uuidv7, type Equipment, type MuscleGroup, type TrackingType } from '@lift/shared';
import { createExerciseMatcher } from '@lift/shared/exercises';
import { and, asc, desc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert } from '@/db/mutations';
import { exercises, workoutExercises, workouts, type Exercise } from '@/db/schema';

/**
 * The subset of an exercise a list screen renders and filters on.
 *
 * `Exercise` has seventeen columns; a row in the library list shows five of
 * them. Selecting the difference costs nothing to write and everything to read
 * — at ~6,800 rows it is the bulk of what crosses the SQLite boundary when the
 * Exercises tab or the mid-workout picker opens.
 */
export type ExerciseListItem = Pick<
  Exercise,
  | 'id'
  | 'name'
  | 'equipment'
  | 'primaryMuscle'
  | 'secondaryMuscles'
  | 'isCustom'
  | 'isArchived'
  | 'thumbnailUrl'
>;

/** Column selection producing `ExerciseListItem`. Pass to `db.select()`. */
export const exerciseListColumns = {
  id: exercises.id,
  name: exercises.name,
  equipment: exercises.equipment,
  primaryMuscle: exercises.primaryMuscle,
  secondaryMuscles: exercises.secondaryMuscles,
  isCustom: exercises.isCustom,
  isArchived: exercises.isArchived,
  thumbnailUrl: exercises.thumbnailUrl,
} as const;

export interface ExerciseFilters {
  search?: string;
  muscle?: MuscleGroup | null;
  equipment?: Equipment | null;
  customOnly?: boolean;
  includeArchived?: boolean;
}

/**
 * The columns `filterExercises` reads.
 *
 * Declared structurally rather than as `Exercise` so list screens can select
 * the eight columns they actually render instead of all seventeen — at ~6,800
 * rows, the unread columns are pure marshalling cost on every load.
 */
export interface FilterableExercise {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  isArchived: boolean;
  isCustom: boolean;
}

/**
 * Filters and ranks an already-loaded library.
 *
 * Kept pure and separate from the query so screens can drive it from
 * `useLiveQuery` — the list then re-filters reactively as rows change, without
 * a database round-trip per keystroke.
 *
 * Everything per-query is hoisted out of the per-row loop: the matcher compiles
 * the search once, and the two predicate branches are chosen before iterating
 * rather than re-tested 6,800 times. Callers should hand this a *deferred*
 * search value — even at this cost it is too much work to run synchronously
 * between two keystrokes.
 */
export function filterExercises<T extends FilterableExercise>(
  rows: readonly T[],
  filters: ExerciseFilters = {},
): T[] {
  const { search, muscle, equipment, customOnly, includeArchived } = filters;

  let result = rows.filter((row) => {
    if (!includeArchived && row.isArchived) return false;
    if (customOnly && !row.isCustom) return false;
    if (equipment && row.equipment !== equipment) return false;
    if (muscle && row.primaryMuscle !== muscle && !row.secondaryMuscles.includes(muscle)) {
      return false;
    }
    return true;
  });

  const match = search ? createExerciseMatcher(search) : null;
  if (match) {
    // One array of scored entries rather than map → filter → sort → map, which
    // allocated four intermediate arrays of up to 6,800 elements per keystroke.
    const scored: { row: T; score: number }[] = [];
    for (const row of result) {
      const score = match(row.name);
      if (score > 0) scored.push({ row, score });
    }

    scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
    result = scored.map((entry) => entry.row);
  }

  return result;
}

/** Non-reactive load, for code paths outside a React render (export, sync). */
export async function listExercises(filters: ExerciseFilters = {}): Promise<Exercise[]> {
  const rows = await db
    .select()
    .from(exercises)
    .where(isNull(exercises.deletedAt))
    .orderBy(asc(exercises.name));

  return filterExercises(rows, filters);
}

/** How many previously-trained exercises the picker offers before the catalog. */
export const RECENT_EXERCISE_LIMIT = 8;

/**
 * The exercises from the most recent finished sessions, most recent first.
 *
 * Returned as an unawaited builder because its only caller feeds it to
 * `useRows`: the picker opens mid-set and this list must not cost a render pass
 * of its own. Grouping by exercise collapses the same lift across sessions to
 * one row, and `max(startedAt)` orders by when you last actually trained it.
 *
 * Finished sessions only. The open session's exercises are the one set of
 * exercises the user demonstrably does *not* need offered back to them, and
 * excluding them keeps the block from reshuffling under the thumb as the
 * session is built.
 *
 * Selecting `from(workoutExercises)` is also what makes this live: drizzle's
 * `useLiveQuery` re-runs a query only when its *primary* table changes, so the
 * joined tables here are read once per mount. That is the right granularity —
 * this list turns over when a session ends, and the picker is mounted fresh
 * every time it opens.
 */
export function recentExercisesQuery(limit: number = RECENT_EXERCISE_LIMIT) {
  return db
    .select(exerciseListColumns)
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
    .where(
      and(
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        isNull(workoutExercises.deletedAt),
        isNull(exercises.deletedAt),
        eq(exercises.isArchived, false),
      ),
    )
    .groupBy(workoutExercises.exerciseId)
    .orderBy(desc(max(workouts.startedAt)))
    .limit(limit);
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  const [row] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  return row;
}

export async function getExercisesByIds(ids: string[]): Promise<Map<string, Exercise>> {
  if (ids.length === 0) return new Map();

  // Resolved in SQL against the primary key. This used to read the whole table
  // and filter in JS with `ids.includes`, which is ~6,800 rows marshalled and
  // an O(rows x ids) scan to find the handful actually asked for.
  const rows = await db.select().from(exercises).where(inArray(exercises.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export interface CreateExerciseInput {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles?: MuscleGroup[];
  trackingType: TrackingType;
  notes?: string | null;
  defaultRestSeconds?: number | null;
}

export async function createCustomExercise(input: CreateExerciseInput): Promise<Exercise> {
  const now = Date.now();
  const row = {
    id: uuidv7(),
    name: input.name.trim(),
    equipment: input.equipment,
    primaryMuscle: input.primaryMuscle,
    secondaryMuscles: input.secondaryMuscles ?? [],
    trackingType: input.trackingType,
    isCustom: true as const,
    notes: input.notes ?? null,
    imageUrl: null,
    // Catalog media only — a user-created exercise has no upstream artwork, so
    // its rows fall back to the initials tile.
    thumbnailUrl: null,
    videoUrl: null,
    isArchived: false,
    defaultRestSeconds: input.defaultRestSeconds ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(exercises).values(row);
  await trackUpsert('exercises', row);

  return row;
}

export async function updateExercise(
  id: string,
  patch: Partial<CreateExerciseInput> & { isArchived?: boolean },
): Promise<void> {
  const stamp = touch();

  await db
    .update(exercises)
    .set({ ...patch, ...stamp })
    .where(eq(exercises.id, id));

  const updated = await getExercise(id);
  if (!updated) return;

  // Built-in exercises exist identically on every device, so only user-created
  // ones are worth replicating.
  if (updated.isCustom) await trackUpsert('exercises', updated);
}

/**
 * Removes a custom exercise.
 *
 * Built-ins are archived instead of deleted — they're part of the shipped
 * library and would simply reappear on the next launch's seed.
 */
export async function deleteExercise(id: string): Promise<void> {
  const existing = await getExercise(id);
  if (!existing) return;

  if (!existing.isCustom) {
    await updateExercise(id, { isArchived: true });
    return;
  }

  const deletedAt = Date.now();
  await db
    .update(exercises)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(exercises.id, id));

  await trackDelete('exercises', id, deletedAt);
}

/** Distinct muscles and equipment present in the library, for filter chips. */
export async function getFilterFacets(): Promise<{
  muscles: MuscleGroup[];
  equipment: Equipment[];
}> {
  const rows = await db
    .select({ muscle: exercises.primaryMuscle, equipment: exercises.equipment })
    .from(exercises)
    .where(and(isNull(exercises.deletedAt), eq(exercises.isArchived, false)));

  return {
    muscles: [...new Set(rows.map((row) => row.muscle))].sort(),
    equipment: [...new Set(rows.map((row) => row.equipment))].sort(),
  };
}
