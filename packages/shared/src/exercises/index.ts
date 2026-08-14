/**
 * Expands the compact seed tuples into the exercise records the app consumes.
 *
 * Built-in exercises deliberately use a **slug** as their primary key rather
 * than a UUID. Every device seeds the identical list from this package, so a
 * routine referencing `bench-press-barbell` resolves the same everywhere with
 * zero rows crossing the network. Only user-created exercises get a UUIDv7 and
 * participate in sync.
 */

import type { Equipment, MuscleGroup, TrackingType } from '../types.ts';
import { EXERCISE_SEEDS, type ExerciseSeed } from './data.ts';

export interface LibraryExercise {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  isCustom: false;
}

/** "Bench Press (Barbell)" → "bench-press-barbell" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function expand(seed: ExerciseSeed): LibraryExercise {
  const [name, equipment, primaryMuscle, secondaryMuscles = [], trackingType = 'weight_reps'] = seed;
  return {
    id: slugify(name),
    name,
    equipment,
    primaryMuscle,
    secondaryMuscles: [...secondaryMuscles],
    trackingType,
    isCustom: false,
  };
}

export const EXERCISE_LIBRARY: readonly LibraryExercise[] = EXERCISE_SEEDS.map(expand);

export const EXERCISE_LIBRARY_BY_ID: ReadonlyMap<string, LibraryExercise> = new Map(
  EXERCISE_LIBRARY.map((exercise) => [exercise.id, exercise]),
);

/**
 * Guards against two seeds slugifying to the same key, which would silently
 * drop an exercise from the library and corrupt any routine pointing at it.
 */
export function findDuplicateExerciseIds(): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const exercise of EXERCISE_LIBRARY) {
    if (seen.has(exercise.id)) duplicates.add(exercise.id);
    seen.add(exercise.id);
  }
  return [...duplicates];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Ranked substring search over exercise names.
 *
 * Deliberately not fuzzy: gym-goers type prefixes ("bench", "rdl"), and fuzzy
 * matching mostly produces confusing far-off hits. Word-prefix matches outrank
 * mid-word ones so "row" surfaces "Row (Cable)" above "Narrow Grip …".
 */
export function scoreExerciseMatch(name: string, query: string): number {
  if (!query) return 0;

  const haystack = name.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 0;

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 500;

  // Match at the start of any word, e.g. "curl" in "Bicep Curl (Barbell)".
  const wordBoundary = new RegExp(`\\b${escapeRegExp(needle)}`);
  if (wordBoundary.test(haystack)) return 250;

  if (haystack.includes(needle)) return 100;

  // All query tokens present in any order: "barbell bench" → "Bench Press (Barbell)".
  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) return 50;

  return 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
