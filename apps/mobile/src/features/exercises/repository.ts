/**
 * Exercise library reads and writes.
 */

import {
  uuidv7,
  type DistanceUnit,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { filterExercises, type ExerciseFilters } from '@lift/shared/exercises';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import { exercises, workoutExercises, workouts, type Exercise } from '@/db/schema';

/**
 * The subset of an exercise a list screen renders and filters on.
 *
 * `Exercise` has seventeen columns; a row in the library list shows five of
 * them. Selecting the difference costs nothing to write and everything to read:
 * at ~6,800 rows it is the bulk of what crosses the SQLite boundary when the
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

/** Non-reactive load, for code paths outside a React render (export, sync). */
export async function listExercises(filters: ExerciseFilters = {}): Promise<Exercise[]> {
  const rows = await db
    .select()
    .from(exercises)
    .where(isNull(exercises.deletedAt))
    .orderBy(asc(exercises.name));

  return filterExercises(rows, filters);
}

// ---------------------------------------------------------------------------
// Training history: what the suggestions are built from
// ---------------------------------------------------------------------------

/**
 * Every exercise appearance in a finished session.
 *
 * Two columns and a date, unaggregated on purpose: usage counts and
 * co-occurrence are two different rollups of the same rows, and pulling them
 * as separate `GROUP BY` queries would read the table twice to answer one
 * question. A heavy log is a few thousand rows here: three years of six-lift
 * sessions is ~3,000, which is an order of magnitude less than the catalog
 * these screens already hold in memory.
 *
 * Returned as an unawaited builder because its callers feed it to `useRows`:
 * the picker opens mid-set and this must not cost a render pass of its own.
 *
 * Finished sessions only. The open session is the caller's own context, passed
 * in separately. Counting it here would let a lift you just added outrank the
 * ones you have trained for months.
 */
export function trainingHistoryQuery() {
  return db
    .select({
      workoutId: workoutExercises.workoutId,
      exerciseId: workoutExercises.exerciseId,
      startedAt: workouts.startedAt,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        isNull(workoutExercises.deletedAt),
      ),
    );
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
    // Catalog media only. A user-created exercise has no upstream artwork, so
    // its rows fall back to the initials tile.
    thumbnailUrl: null,
    videoUrl: null,
    isArchived: false,
    defaultRestSeconds: input.defaultRestSeconds ?? null,
    // Null, not the current setting: a new exercise inherits whatever the app
    // is set to *at the time it is read*, which is what someone who later
    // switches the app to pounds expects of an exercise they never spoke for.
    // Copying the setting in here would freeze today's answer onto the row.
    weightUnit: null,
    distanceUnit: null,
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
 * Sets the units this exercise is displayed in, now and in every later session.
 *
 * Scoped to the exercise on purpose, and this is the whole point of the column:
 * the unit headings in a workout used to write the app-wide setting, so
 * switching the dumbbell press to pounds re-labelled the squat, the leg press
 * and every figure on the history screen along with it. What the user meant was
 * "this rack is in pounds".
 *
 * Persisted rather than held for the session, for the reason per-exercise rest
 * is: the rack does not change units between Tuesdays, and re-choosing it every
 * week is the thing that makes a per-exercise setting not worth having.
 *
 * `null` for either clears that override and returns the exercise to the
 * app-wide setting. Omitting a key leaves it alone, so the weight heading and
 * the distance heading can be set independently: a rowing machine reasonably
 * reports metres while its resistance means nothing in either unit.
 */
export async function setExerciseUnits(
  exerciseId: string,
  units: { weightUnit?: WeightUnit | null; distanceUnit?: DistanceUnit | null },
): Promise<void> {
  const patch: Partial<Pick<Exercise, 'weightUnit' | 'distanceUnit'>> = {};

  if ('weightUnit' in units) patch.weightUnit = units.weightUnit ?? null;
  if ('distanceUnit' in units) patch.distanceUnit = units.distanceUnit ?? null;
  if (Object.keys(patch).length === 0) return;

  await db
    .update(exercises)
    .set({ ...patch, ...touch() })
    .where(eq(exercises.id, exerciseId));

  const updated = await getExercise(exerciseId);

  // Built-ins exist identically on every device and never cross the wire, so
  // only a user-created exercise is worth replicating: the same rule
  // `setExerciseRest` follows, and with the same consequence: a unit set on a
  // catalog movement is local to this phone. Coalesced because the heading is a
  // toggle, and settling on pounds after two taps should leave one row to push.
  if (updated?.isCustom) await trackUpsertCoalesced('exercises', updated);
}

/**
 * Removes a custom exercise.
 *
 * Built-ins are archived instead of deleted: they're part of the shipped
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
