/**
 * Routine (workout template) reads and writes.
 *
 * A routine stores *prescribed* work (exercises and target sets) which
 * `startWorkout` materialises into a live session. The two are deliberately
 * separate tables: editing a routine must never rewrite history.
 */

import {
  normalizeSupersets,
  uuidv7,
  type PositionedRow,
  type SetType,
  type SupersetAssignment,
} from '@lift/shared';
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

/**
 * Applies the writes a reorder produced.
 *
 * Takes the rows rather than a from/to pair because the caller has already done
 * the arithmetic: `reorder()` in `@lift/shared` decides whether a move is one
 * midpoint or a full renumber, and this only has to write whatever it handed
 * back. Usually that is a single row.
 *
 * Sequential rather than batched: each write also emits an oplog entry, and the
 * sync layer's coalescing is per row. A renumber of ten exercises is ten
 * statements, which happens roughly never: see `MIN_GAP` in `ordering.ts`.
 */
export async function applyRoutineExerciseOrder(updates: PositionedRow[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, position } of updates) {
    await db
      .update(routineExercises)
      .set({ position, ...touch() })
      .where(eq(routineExercises.id, id));

    const [updated] = await db
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('routine_exercises', updated);
  }
}

/**
 * Applies the writes a superset edit produced.
 *
 * The sibling of `applyRoutineExerciseOrder`, and the same contract: the
 * arithmetic is `supersets.ts`' in `@lift/shared`, and this writes the rows it
 * named. Prescribing a superset in a routine is what makes the session start
 * with one, because `copyRoutineIntoWorkout` carries `supersetGroup` across
 * with the notes and the rest.
 *
 * **The editor calls this after a reorder as well.** A drag that lands an
 * exercise between two halves of a superset has dismantled it, and
 * `normalizeSupersets` is the only thing that notices.
 */
export async function applyRoutineSupersetGroups(updates: SupersetAssignment[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, supersetGroup } of updates) {
    await db
      .update(routineExercises)
      .set({ supersetGroup, ...touch() })
      .where(eq(routineExercises.id, id));

    const [updated] = await db
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('routine_exercises', updated);
  }
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

  // Read before the tombstone, so the superset sweep at the end knows which
  // routine to look at.
  const [link] = await db
    .select({ routineId: routineExercises.routineId })
    .from(routineExercises)
    .where(eq(routineExercises.id, routineExerciseId))
    .limit(1);

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

  /*
   * Taking one half of a pair out of the routine leaves the other half holding
   * a group id with nothing to be paired with, which is not a superset.
   *
   * This also runs once per exercise while `deleteRoutine` empties a routine it
   * is about to tombstone, which is a write or two the wire did not need. The
   * alternative is a second removal path that skips the sweep, and a path that
   * exists only to be faster in the one case where nothing is left to be
   * correct about is how the invariant gets lost.
   */
  if (link) {
    const links = await db
      .select({ id: routineExercises.id, supersetGroup: routineExercises.supersetGroup })
      .from(routineExercises)
      .where(and(eq(routineExercises.routineId, link.routineId), isNull(routineExercises.deletedAt)))
      .orderBy(asc(routineExercises.position));

    await applyRoutineSupersetGroups(normalizeSupersets(links));
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
