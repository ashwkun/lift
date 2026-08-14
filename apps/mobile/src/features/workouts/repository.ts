/**
 * Workout session lifecycle: start → log → finish.
 *
 * The in-progress session is an ordinary `workouts` row with `finishedAt` null
 * rather than in-memory state. A force-quit mid-set therefore loses nothing, and
 * "resume workout" needs no special persistence path.
 */

import {
  detectPrs,
  summarizeSets,
  uuidv7,
  type AnalyticsContext,
  type PrKind,
  type SetLike,
  type SetType,
} from '@lift/shared';
import { and, desc, eq, inArray, isNull, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import {
  exercises,
  personalRecords,
  routineExercises,
  routineSets,
  routines,
  workoutExercises,
  workoutSets,
  workouts,
  type Exercise,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/db/schema';

// ---------------------------------------------------------------------------
// Composite read models
// ---------------------------------------------------------------------------

export interface WorkoutExerciseDetail {
  workoutExercise: WorkoutExercise;
  exercise: Exercise;
  sets: WorkoutSet[];
}

export interface WorkoutDetail {
  workout: Workout;
  exercises: WorkoutExerciseDetail[];
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** The single unfinished session, if one exists. */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const [row] = await db
    .select()
    .from(workouts)
    .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);

  return row;
}

/**
 * Begins a session, optionally pre-filled from a routine.
 *
 * Refuses to start a second one — two concurrent sessions would make "the
 * active workout" ambiguous everywhere downstream.
 */
export async function startWorkout(options: {
  routineId?: string;
  name?: string;
} = {}): Promise<Workout> {
  const existing = await getActiveWorkout();
  if (existing) return existing;

  const now = Date.now();
  const routine = options.routineId ? await getRoutine(options.routineId) : undefined;

  const workout = {
    id: uuidv7(),
    routineId: options.routineId ?? null,
    name: options.name ?? routine?.name ?? defaultWorkoutName(new Date(now)),
    notes: null,
    startedAt: new Date(now),
    finishedAt: null,
    durationSeconds: null,
    totalVolumeKg: 0,
    totalSets: 0,
    totalReps: 0,
    prCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workouts).values(workout);
  await trackUpsert('workouts', serializeWorkout(workout));

  if (options.routineId) await copyRoutineIntoWorkout(options.routineId, workout.id);

  return workout;
}

/** "Morning Workout" / "Afternoon Workout" / "Evening Workout", Hevy-style. */
function defaultWorkoutName(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Morning Workout';
  if (hour < 17) return 'Afternoon Workout';
  if (hour < 21) return 'Evening Workout';
  return 'Night Workout';
}

async function getRoutine(routineId: string) {
  const [row] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  return row;
}

/** Materialises a routine's prescribed exercises and target sets into a session. */
async function copyRoutineIntoWorkout(routineId: string, workoutId: string): Promise<void> {
  const planned = await db
    .select()
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)))
    .orderBy(routineExercises.position);

  for (const plannedExercise of planned) {
    const created = await addExerciseToWorkout(workoutId, plannedExercise.exerciseId, {
      position: plannedExercise.position,
      notes: plannedExercise.notes,
      restSeconds: plannedExercise.restSeconds,
      supersetGroup: plannedExercise.supersetGroup,
    });

    const targets = await db
      .select()
      .from(routineSets)
      .where(
        and(eq(routineSets.routineExerciseId, plannedExercise.id), isNull(routineSets.deletedAt)),
      )
      .orderBy(routineSets.position);

    for (const target of targets) {
      await addSet(created.id, {
        position: target.position,
        setType: target.setType,
        // Targets seed the row but stay unchecked — the user still logs what
        // they actually did.
        weightKg: target.targetWeightKg,
        reps: target.targetReps,
        durationSeconds: target.targetDurationSeconds,
        distanceKm: target.targetDistanceKm,
        rpe: target.targetRpe,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Exercises within a session
// ---------------------------------------------------------------------------

export async function addExerciseToWorkout(
  workoutId: string,
  exerciseId: string,
  options: {
    position?: number;
    notes?: string | null;
    restSeconds?: number | null;
    supersetGroup?: number | null;
  } = {},
): Promise<WorkoutExercise> {
  const now = Date.now();
  const position = options.position ?? (await nextPosition(workoutId));

  const row = {
    id: uuidv7(),
    workoutId,
    exerciseId,
    position,
    notes: options.notes ?? null,
    restSeconds: options.restSeconds ?? null,
    supersetGroup: options.supersetGroup ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workoutExercises).values(row);
  await trackUpsert('workout_exercises', row);

  return row;
}

async function nextPosition(workoutId: string): Promise<number> {
  const rows = await db
    .select({ position: workoutExercises.position })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)));

  return rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

export async function removeExerciseFromWorkout(workoutExerciseId: string): Promise<void> {
  const deletedAt = Date.now();

  await db
    .update(workoutExercises)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workoutExercises.id, workoutExerciseId));

  await trackDelete('workout_exercises', workoutExerciseId, deletedAt);

  // Tombstone the children explicitly. SQLite's ON DELETE CASCADE only fires on
  // a real DELETE, and a soft delete of the parent would otherwise leave the
  // sets alive on other devices.
  const children = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, workoutExerciseId), isNull(workoutSets.deletedAt)));

  for (const child of children) {
    await db
      .update(workoutSets)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(workoutSets.id, child.id));
    await trackDelete('workout_sets', child.id, deletedAt);
  }
}

/** Reorders exercises by rewriting only the moved row's fractional position. */
export async function reorderExercise(
  workoutExerciseId: string,
  newPosition: number,
): Promise<void> {
  const stamp = touch();
  await db
    .update(workoutExercises)
    .set({ position: newPosition, ...stamp })
    .where(eq(workoutExercises.id, workoutExerciseId));

  const [updated] = await db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .limit(1);

  if (updated) await trackUpsertCoalesced('workout_exercises', updated);
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export interface SetInput {
  position?: number;
  setType?: SetType;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceKm?: number | null;
  rpe?: number | null;
  isCompleted?: boolean;
}

export async function addSet(
  workoutExerciseId: string,
  input: SetInput = {},
): Promise<WorkoutSet> {
  const now = Date.now();

  const position = input.position ?? (await nextSetPosition(workoutExerciseId));

  const row = {
    id: uuidv7(),
    workoutExerciseId,
    position,
    setType: input.setType ?? 'normal',
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    durationSeconds: input.durationSeconds ?? null,
    distanceKm: input.distanceKm ?? null,
    rpe: input.rpe ?? null,
    isCompleted: input.isCompleted ?? false,
    completedAt: input.isCompleted ? new Date(now) : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workoutSets).values(row);
  await trackUpsert('workout_sets', serializeSet(row));

  return row;
}

async function nextSetPosition(workoutExerciseId: string): Promise<number> {
  const rows = await db
    .select({ position: workoutSets.position })
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, workoutExerciseId), isNull(workoutSets.deletedAt)));

  return rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

/**
 * Updates a set.
 *
 * Uses the coalescing oplog write because editing a weight field emits a
 * mutation per keystroke; only the final value needs to reach the server.
 */
export async function updateSet(setId: string, patch: SetInput): Promise<void> {
  const changes: Record<string, unknown> = { ...patch, ...touch() };

  // Completion time is derived, never passed in by callers.
  if (patch.isCompleted !== undefined) {
    changes.completedAt = patch.isCompleted ? new Date() : null;
  }

  await db.update(workoutSets).set(changes).where(eq(workoutSets.id, setId));

  const [updated] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId)).limit(1);
  if (updated) await trackUpsertCoalesced('workout_sets', serializeSet(updated));
}

export async function deleteSet(setId: string): Promise<void> {
  const deletedAt = Date.now();

  await db
    .update(workoutSets)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workoutSets.id, setId));

  await trackDelete('workout_sets', setId, deletedAt);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getWorkoutDetail(workoutId: string): Promise<WorkoutDetail | undefined> {
  const [workout] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  if (!workout) return undefined;

  const links = await db
    .select()
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
    .orderBy(workoutExercises.position);

  if (links.length === 0) return { workout, exercises: [] };

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(inArray(exercises.id, [...new Set(links.map((link) => link.exerciseId))]));

  const exerciseById = new Map(exerciseRows.map((row) => [row.id, row]));

  const setRows = await db
    .select()
    .from(workoutSets)
    .where(
      and(
        inArray(workoutSets.workoutExerciseId, links.map((link) => link.id)),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(workoutSets.position);

  const setsByParent = new Map<string, WorkoutSet[]>();
  for (const set of setRows) {
    const bucket = setsByParent.get(set.workoutExerciseId);
    if (bucket) bucket.push(set);
    else setsByParent.set(set.workoutExerciseId, [set]);
  }

  const details: WorkoutExerciseDetail[] = [];
  for (const link of links) {
    const exercise = exerciseById.get(link.exerciseId);
    // An exercise deleted out from under a historical workout shouldn't crash
    // the screen; skip the orphan rather than rendering a broken row.
    if (!exercise) continue;

    details.push({
      workoutExercise: link,
      exercise,
      sets: setsByParent.get(link.id) ?? [],
    });
  }

  return { workout, exercises: details };
}

export async function listCompletedWorkouts(limit = 50, offset = 0): Promise<Workout[]> {
  return db
    .select()
    .from(workouts)
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * The sets logged for this exercise in the most recent completed session,
 * used to pre-fill the "previous" column on the logging screen.
 */
export async function getPreviousPerformance(
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<WorkoutSet[]> {
  const links = await db
    .select({ id: workoutExercises.id, startedAt: workouts.startedAt, workoutId: workouts.id })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        isNull(workoutExercises.deletedAt),
      ),
    )
    .orderBy(desc(workouts.startedAt))
    .limit(5);

  const candidate = links.find((link) => link.workoutId !== excludeWorkoutId);
  if (!candidate) return [];

  return db
    .select()
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.workoutExerciseId, candidate.id),
        eq(workoutSets.isCompleted, true),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(workoutSets.position);
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

export interface FinishResult {
  workout: Workout;
  prCount: number;
}

/**
 * Closes out a session: drops unchecked sets, recomputes totals, and awards PRs.
 *
 * Unlogged sets are discarded rather than saved as zeros — a planned fourth set
 * the user never did should not drag their averages down or count toward volume.
 */
export async function finishWorkout(
  workoutId: string,
  options: { bodyweightKg?: number; formula?: AnalyticsContext['formula'] } = {},
): Promise<FinishResult> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) throw new Error(`Workout ${workoutId} not found`);

  const finishedAt = Date.now();

  for (const entry of detail.exercises) {
    for (const set of entry.sets) {
      if (!set.isCompleted) await deleteSet(set.id);
    }
  }

  const fresh = await getWorkoutDetail(workoutId);
  if (!fresh) throw new Error(`Workout ${workoutId} vanished mid-finish`);

  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;
  let prCount = 0;

  for (const entry of fresh.exercises) {
    // Skip exercises left with no completed sets at all.
    if (entry.sets.length === 0) {
      await removeExerciseFromWorkout(entry.workoutExercise.id);
      continue;
    }

    const ctx: AnalyticsContext = {
      trackingType: entry.exercise.trackingType,
      bodyweightKg: options.bodyweightKg,
      formula: options.formula,
    };

    const summary = summarizeSets(entry.sets as SetLike[], ctx);
    totalVolume += summary.volumeKg;
    totalSets += summary.workingSets;
    totalReps += summary.totalReps;

    const previous = await getPreviousBests(entry.exercise.id);
    const prs = detectPrs(entry.sets as SetLike[], ctx, previous);

    for (const pr of prs) {
      const setId = pr.setIndex === null ? null : (entry.sets[pr.setIndex]?.id ?? null);
      await recordPr({
        exerciseId: entry.exercise.id,
        kind: pr.kind,
        value: pr.value,
        reps: pr.setIndex === null ? null : (entry.sets[pr.setIndex]?.reps ?? null),
        setId,
        workoutId,
        achievedAt: finishedAt,
      });
      prCount += 1;
    }
  }

  const durationSeconds = Math.max(
    0,
    Math.round((finishedAt - fresh.workout.startedAt.getTime()) / 1000),
  );

  const updates = {
    finishedAt: new Date(finishedAt),
    durationSeconds,
    totalVolumeKg: totalVolume,
    totalSets,
    totalReps,
    prCount,
    updatedAt: finishedAt,
    syncState: 'pending' as const,
  };

  await db.update(workouts).set(updates).where(eq(workouts.id, workoutId));

  if (fresh.workout.routineId) {
    await db
      .update(routines)
      .set({ lastPerformedAt: new Date(finishedAt), updatedAt: finishedAt, syncState: 'pending' })
      .where(eq(routines.id, fresh.workout.routineId));
  }

  const [saved] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  if (saved) await trackUpsertCoalesced('workouts', serializeWorkout(saved));

  return { workout: saved!, prCount };
}

/** Abandons a session, tombstoning it and everything under it. */
export async function discardWorkout(workoutId: string): Promise<void> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) return;

  for (const entry of detail.exercises) {
    await removeExerciseFromWorkout(entry.workoutExercise.id);
  }

  const deletedAt = Date.now();
  await db
    .update(workouts)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workouts.id, workoutId));

  await trackDelete('workouts', workoutId, deletedAt);
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

async function getPreviousBests(exerciseId: string) {
  const rows = await db
    .select()
    .from(personalRecords)
    .where(and(eq(personalRecords.exerciseId, exerciseId), isNull(personalRecords.deletedAt)));

  const best = (kind: PrKind) =>
    rows.filter((row) => row.kind === kind).reduce((max, row) => Math.max(max, row.value), 0) ||
    undefined;

  return {
    heaviestKg: best('heaviest_weight'),
    bestOneRepMaxKg: best('best_1rm'),
    bestSetVolumeKg: best('best_set_volume'),
    bestSessionVolumeKg: best('best_session_volume'),
    mostReps: best('most_reps'),
    bestDurationSeconds: best('best_duration'),
    bestDistanceKm: best('best_distance'),
  };
}

async function recordPr(input: {
  exerciseId: string;
  kind: PrKind;
  value: number;
  reps: number | null;
  setId: string | null;
  workoutId: string;
  achievedAt: number;
}): Promise<void> {
  const now = Date.now();
  const row = {
    id: uuidv7(),
    exerciseId: input.exerciseId,
    kind: input.kind,
    value: input.value,
    reps: input.reps,
    setId: input.setId,
    workoutId: input.workoutId,
    achievedAt: new Date(input.achievedAt),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(personalRecords).values(row);
  await trackUpsert('personal_records', {
    ...row,
    achievedAt: input.achievedAt,
  });
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

// Drizzle hands back `Date` for timestamp_ms columns, but the sync payload must
// be JSON-safe and comparable as a number on the server.

function serializeWorkout<
  T extends { id: string; updatedAt: number; startedAt: Date; finishedAt: Date | null },
>(row: T) {
  return {
    ...row,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt?.getTime() ?? null,
  };
}

function serializeSet<T extends { id: string; updatedAt: number; completedAt: Date | null }>(
  row: T,
) {
  return {
    ...row,
    completedAt: row.completedAt?.getTime() ?? null,
  };
}
