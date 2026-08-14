/**
 * Routine (workout template) reads and writes.
 *
 * A routine stores *prescribed* work — exercises and target sets — which
 * `startWorkout` materialises into a live session. The two are deliberately
 * separate tables: editing a routine must never rewrite history.
 */

import { uuidv7, type SetType } from '@ironlog/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import {
  exercises,
  routineExercises,
  routineSets,
  routines,
  type Exercise,
  type Routine,
  type RoutineExercise,
  type RoutineSet,
} from '@/db/schema';

export interface RoutineExerciseDetail {
  routineExercise: RoutineExercise;
  exercise: Exercise;
  sets: RoutineSet[];
}

export interface RoutineDetail {
  routine: Routine;
  exercises: RoutineExerciseDetail[];
}

export async function createRoutine(input: {
  name: string;
  folderId?: string | null;
  notes?: string | null;
}): Promise<Routine> {
  const now = Date.now();

  const existing = await db
    .select({ position: routines.position })
    .from(routines)
    .where(isNull(routines.deletedAt));

  const row = {
    id: uuidv7(),
    folderId: input.folderId ?? null,
    name: input.name.trim() || 'New Routine',
    notes: input.notes ?? null,
    position: existing.reduce((max, item) => Math.max(max, item.position), 0) + 1,
    lastPerformedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(routines).values(row);
  await trackUpsert('routines', { ...row, lastPerformedAt: null });

  return row;
}

export async function updateRoutine(
  routineId: string,
  patch: { name?: string; notes?: string | null; folderId?: string | null },
): Promise<void> {
  await db
    .update(routines)
    .set({ ...patch, ...touch() })
    .where(eq(routines.id, routineId));

  const [updated] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  if (updated) {
    await trackUpsertCoalesced('routines', {
      ...updated,
      lastPerformedAt: updated.lastPerformedAt?.getTime() ?? null,
    });
  }
}

export async function getRoutineDetail(routineId: string): Promise<RoutineDetail | undefined> {
  const [routine] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  if (!routine) return undefined;

  const links = await db
    .select()
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)))
    .orderBy(asc(routineExercises.position));

  if (links.length === 0) return { routine, exercises: [] };

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(inArray(exercises.id, [...new Set(links.map((link) => link.exerciseId))]));

  const exerciseById = new Map(exerciseRows.map((row) => [row.id, row]));

  const setRows = await db
    .select()
    .from(routineSets)
    .where(
      and(
        inArray(routineSets.routineExerciseId, links.map((link) => link.id)),
        isNull(routineSets.deletedAt),
      ),
    )
    .orderBy(asc(routineSets.position));

  const setsByParent = new Map<string, RoutineSet[]>();
  for (const set of setRows) {
    const bucket = setsByParent.get(set.routineExerciseId);
    if (bucket) bucket.push(set);
    else setsByParent.set(set.routineExerciseId, [set]);
  }

  return {
    routine,
    exercises: links.flatMap((link) => {
      const exercise = exerciseById.get(link.exerciseId);
      if (!exercise) return [];
      return [{ routineExercise: link, exercise, sets: setsByParent.get(link.id) ?? [] }];
    }),
  };
}

export async function addExerciseToRoutine(
  routineId: string,
  exerciseId: string,
): Promise<RoutineExercise> {
  const now = Date.now();

  const siblings = await db
    .select({ position: routineExercises.position })
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)));

  const row = {
    id: uuidv7(),
    routineId,
    exerciseId,
    position: siblings.reduce((max, item) => Math.max(max, item.position), 0) + 1,
    notes: null,
    restSeconds: null,
    supersetGroup: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(routineExercises).values(row);
  await trackUpsert('routine_exercises', row);

  // A routine exercise with no sets is meaningless, so seed one.
  await addRoutineSet(row.id);

  return row;
}

export async function addRoutineSet(
  routineExerciseId: string,
  input: {
    setType?: SetType;
    targetReps?: number | null;
    targetWeightKg?: number | null;
  } = {},
): Promise<RoutineSet> {
  const now = Date.now();

  const siblings = await db
    .select({ position: routineSets.position })
    .from(routineSets)
    .where(
      and(eq(routineSets.routineExerciseId, routineExerciseId), isNull(routineSets.deletedAt)),
    );

  const row = {
    id: uuidv7(),
    routineExerciseId,
    position: siblings.reduce((max, item) => Math.max(max, item.position), 0) + 1,
    setType: input.setType ?? ('normal' as const),
    targetReps: input.targetReps ?? null,
    targetWeightKg: input.targetWeightKg ?? null,
    targetDurationSeconds: null,
    targetDistanceKm: null,
    targetRpe: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(routineSets).values(row);
  await trackUpsert('routine_sets', row);

  return row;
}

export async function updateRoutineSet(
  setId: string,
  patch: Partial<Pick<RoutineSet, 'targetReps' | 'targetWeightKg' | 'setType' | 'targetRpe'>>,
): Promise<void> {
  await db
    .update(routineSets)
    .set({ ...patch, ...touch() })
    .where(eq(routineSets.id, setId));

  const [updated] = await db.select().from(routineSets).where(eq(routineSets.id, setId)).limit(1);
  if (updated) await trackUpsertCoalesced('routine_sets', updated);
}

export async function deleteRoutineSet(setId: string): Promise<void> {
  const deletedAt = Date.now();
  await db
    .update(routineSets)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routineSets.id, setId));

  await trackDelete('routine_sets', setId, deletedAt);
}

export async function removeExerciseFromRoutine(routineExerciseId: string): Promise<void> {
  const deletedAt = Date.now();

  await db
    .update(routineExercises)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routineExercises.id, routineExerciseId));

  await trackDelete('routine_exercises', routineExerciseId, deletedAt);

  // Soft deletes don't cascade, so tombstone the child sets by hand.
  const children = await db
    .select({ id: routineSets.id })
    .from(routineSets)
    .where(
      and(eq(routineSets.routineExerciseId, routineExerciseId), isNull(routineSets.deletedAt)),
    );

  for (const child of children) {
    await db
      .update(routineSets)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(routineSets.id, child.id));
    await trackDelete('routine_sets', child.id, deletedAt);
  }
}

export async function deleteRoutine(routineId: string): Promise<void> {
  const detail = await getRoutineDetail(routineId);
  if (!detail) return;

  for (const entry of detail.exercises) {
    await removeExerciseFromRoutine(entry.routineExercise.id);
  }

  const deletedAt = Date.now();
  await db
    .update(routines)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routines.id, routineId));

  await trackDelete('routines', routineId, deletedAt);
}
