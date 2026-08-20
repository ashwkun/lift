/**
 * Getting imported exercise names onto rows in the library.
 *
 * This is where an import quietly succeeds or quietly ruins itself. A name that
 * fails to find its catalog entry creates a second exercise with the same
 * meaning, and from then on the user's bench press history is split in two —
 * across the progress chart, the records list and every muscle rollup — with
 * nothing on screen to explain why. So the matching runs in one pass over the
 * whole file rather than per row, and it is exact-then-normalised rather than
 * fuzzy: a near miss the user can see and merge beats a confident wrong answer.
 */

import { uuidv7, type Equipment, type MuscleGroup, type TrackingType } from '@lift/shared';
import {
  collectExerciseNames,
  exerciseMatchKey,
  inferEquipment,
  inferTrackingType,
  type ImportedSet,
  type ImportedWorkout,
} from '@lift/shared/import';
import { isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { trackUpsertMany } from '@/db/mutations';
import { exercises } from '@/db/schema';

export interface ExercisePlan {
  /** Keyed by the lower-cased name as the file spelled it. */
  idByName: Map<string, string>;
  /**
   * Tracking type per resolved id.
   *
   * Carried out of here rather than re-read later because the importer needs it
   * for every set it values — it decides whether a rep counts as `weight ×
   * reps` or as bodyweight — and the read that produced the id already had it.
   */
  trackingTypeById: Map<string, TrackingType>;
  /** Names that found an existing library entry. */
  matched: string[];
  /** Names that did not. Rows for these are built but not yet written. */
  created: string[];
  pending: NewCustomExercise[];
}

/**
 * Works out where every name in a file lands, writing nothing.
 *
 * Planning and committing are separate calls because the confirmation screen
 * has to be able to say "12 exercises will be added to your library" while the
 * user is still deciding. A resolver that created rows as it matched would make
 * that sentence a side effect: back out of the import and the library keeps the
 * twelve exercises anyway, attached to no history at all.
 */
export async function planExercises(
  workouts: readonly ImportedWorkout[],
): Promise<ExercisePlan> {
  const names = collectExerciseNames(workouts);
  const idByName = new Map<string, string>();
  const matched: string[] = [];
  const created: string[] = [];
  const pending: NewCustomExercise[] = [];

  if (names.length === 0) {
    return { idByName, trackingTypeById: new Map(), matched, created, pending };
  }

  const { exact, loose, trackingTypeById } = await loadLibraryIndex();
  const setsByName = groupSetsByName(workouts);

  for (const name of names) {
    const key = name.toLowerCase();
    const hit = exact.get(key) ?? loose.get(exerciseMatchKey(name));

    if (hit) {
      idByName.set(key, hit);
      matched.push(name);
      continue;
    }

    const row = buildCustomExercise(name, setsByName.get(key) ?? []);
    pending.push(row);
    idByName.set(key, row.id);
    trackingTypeById.set(row.id, row.trackingType);
    created.push(name);

    // A file can spell the same exercise two ways — "Ab Wheel" and "Ab Wheels"
    // — and both miss the catalog. Registering the new row against its own
    // normalised key means the second spelling finds the first rather than
    // creating a twin.
    loose.set(exerciseMatchKey(name), row.id);
    exact.set(key, row.id);
  }

  return { idByName, trackingTypeById, matched, created, pending };
}

/** Writes the exercises a plan invented. Safe to call with nothing pending. */
export async function commitExercises(plan: ExercisePlan): Promise<void> {
  if (plan.pending.length === 0) return;

  for (let i = 0; i < plan.pending.length; i += CHUNK_SIZE) {
    await db.insert(exercises).values(plan.pending.slice(i, i + CHUNK_SIZE));
  }

  // Custom exercises replicate; the history about to reference them would
  // arrive at the server pointing at nothing otherwise.
  await trackUpsertMany('exercises', plan.pending);
}

const CHUNK_SIZE = 50;

type NewCustomExercise = ReturnType<typeof buildCustomExercise>;

function buildCustomExercise(name: string, sets: ImportedSet[]) {
  const now = Date.now();

  return {
    id: uuidv7(),
    name: name.trim(),
    equipment: inferEquipment(name) as Equipment,
    // Nothing in an export says which muscle a lift trains, and guessing from
    // the name would put "Ring Row" under whatever the guess happened to be.
    // `other` is visibly unset, which is the state that gets corrected; a
    // plausible wrong muscle is the state that silently skews the body map.
    primaryMuscle: 'other' as MuscleGroup,
    secondaryMuscles: [] as MuscleGroup[],
    trackingType: inferTrackingType(name, sets) as TrackingType,
    isCustom: true as const,
    notes: null,
    imageUrl: null,
    thumbnailUrl: null,
    videoUrl: null,
    isArchived: false,
    defaultRestSeconds: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };
}

/**
 * Two lookups over the library, built in one read.
 *
 * The catalog is ~6,800 rows and this pulls two columns of it, which is the
 * same read the exercise picker already makes on open. Doing it once here is
 * the whole reason the resolver takes the file rather than a name.
 */
async function loadLibraryIndex(): Promise<{
  exact: Map<string, string>;
  loose: Map<string, string>;
  trackingTypeById: Map<string, TrackingType>;
}> {
  const rows = await db
    .select({ id: exercises.id, name: exercises.name, trackingType: exercises.trackingType })
    .from(exercises)
    .where(isNull(exercises.deletedAt));

  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  const trackingTypeById = new Map<string, TrackingType>();

  for (const row of rows) {
    trackingTypeById.set(row.id, row.trackingType);

    const lower = row.name.toLowerCase();
    if (!exact.has(lower)) exact.set(lower, row.id);

    // Normalised keys collide by design — "Row (Cable)" and "Cable Row" reduce
    // to the same thing, which is the point. First writer wins, and the read
    // above is ordered by nothing in particular, so this is settled by the id:
    // stable across imports, which is what stops the same file resolving to
    // different exercises on two devices.
    const key = exerciseMatchKey(row.name);
    const existing = loose.get(key);
    if (existing === undefined || row.id < existing) loose.set(key, row.id);
  }

  return { exact, loose, trackingTypeById };
}

/** Every set logged against each name, so a created exercise can be typed from its data. */
function groupSetsByName(workouts: readonly ImportedWorkout[]): Map<string, ImportedSet[]> {
  const byName = new Map<string, ImportedSet[]>();

  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const key = exercise.name.toLowerCase();
      const bucket = byName.get(key);
      if (bucket) bucket.push(...exercise.sets);
      else byName.set(key, [...exercise.sets]);
    }
  }

  return byName;
}
