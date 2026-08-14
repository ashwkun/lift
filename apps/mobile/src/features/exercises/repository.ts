/**
 * Exercise library reads and writes.
 */

import {
  scoreExerciseMatch,
  uuidv7,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from '@ironlog/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert } from '@/db/mutations';
import { exercises, type Exercise } from '@/db/schema';

export interface ExerciseFilters {
  search?: string;
  muscle?: MuscleGroup | null;
  equipment?: Equipment | null;
  customOnly?: boolean;
  includeArchived?: boolean;
}

/**
 * Filters and ranks an already-loaded library.
 *
 * Kept pure and separate from the query so screens can drive it from
 * `useLiveQuery` — the list then re-filters reactively as rows change, without
 * a database round-trip per keystroke. The library is ~230 rows, so this is far
 * cheaper than expressing ranked relevance in SQL.
 */
export function filterExercises(
  rows: readonly Exercise[],
  filters: ExerciseFilters = {},
): Exercise[] {
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

  const query = search?.trim();
  if (query) {
    result = result
      .map((row) => ({ row, score: scoreExerciseMatch(row.name, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
      .map((entry) => entry.row);
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

export async function getExercise(id: string): Promise<Exercise | undefined> {
  const [row] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  return row;
}

export async function getExercisesByIds(ids: string[]): Promise<Map<string, Exercise>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(exercises);
  return new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row]));
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
