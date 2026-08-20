/**
 * Expands the generated catalog into the exercise records the app consumes.
 *
 * Built-in exercises deliberately use a **slug** as their primary key rather
 * than a UUID. Every device seeds the identical list from this package, so a
 * routine referencing `barbell-bench-press` resolves the same everywhere with
 * zero rows crossing the network. Only user-created exercises get a UUIDv7 and
 * participate in sync.
 */

import { EQUIPMENT, MUSCLE_GROUPS, TRACKING_TYPES } from '../types.ts';
import type { Equipment, MuscleGroup, TrackingType } from '../types.ts';
import { ASSET_PREFIXES, EXERCISE_CATALOG, type CatalogEntry } from './catalog.ts';

export interface LibraryExercise {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  isCustom: false;
  /** Demonstration clip. Null for roughly a third of the catalog. */
  videoUrl: string | null;
  /** Still frame, and the list thumbnail. Present for ~94% of the catalog. */
  thumbnailUrl: string | null;
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

function url(prefix: number, file: string): string | null {
  return prefix < 0 || !file ? null : `${ASSET_PREFIXES[prefix]}${file}`;
}

function expand(entry: CatalogEntry): LibraryExercise {
  const [id, name, equipment, primary, secondary, tracking, vPrefix, vFile, tPrefix, tFile] = entry;

  return {
    id,
    name,
    equipment: EQUIPMENT[equipment]!,
    primaryMuscle: MUSCLE_GROUPS[primary]!,
    secondaryMuscles: secondary.map((index) => MUSCLE_GROUPS[index]!),
    trackingType: TRACKING_TYPES[tracking]!,
    isCustom: false,
    videoUrl: url(vPrefix, vFile),
    thumbnailUrl: url(tPrefix, tFile),
  };
}

export const EXERCISE_LIBRARY: readonly LibraryExercise[] = EXERCISE_CATALOG.map(expand);

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

/** Scores one name against a query already compiled by `createExerciseMatcher`. */
export type ExerciseMatcher = (name: string) => number;

/**
 * Compiles a query once, then scores names against it.
 *
 * The catalog is ~6,800 rows and the list re-filters on every keystroke, so
 * anything done per row is done 6,800 times per character typed. Building the
 * word-boundary `RegExp` is the expensive part — hoisting it out of the loop
 * measured 6.2-6.5x faster over the real catalog, which is the difference
 * between a search that keeps up with the keyboard and one that doesn't.
 *
 * Returns `null` for an empty query, which callers read as "no search applied"
 * rather than "nothing matched".
 */
export function createExerciseMatcher(query: string): ExerciseMatcher | null {
  const needle = query.toLowerCase().trim();
  if (!needle) return null;

  // Matches at the start of any word, e.g. "curl" in "Bicep Curl (Barbell)".
  const wordBoundary = new RegExp(`\\b${escapeRegExp(needle)}`);

  // All query tokens present in any order: "barbell bench" → "Bench Press (Barbell)".
  const tokens = needle.split(/\s+/).filter(Boolean);
  const multiToken = tokens.length > 1 ? tokens : null;

  return (name) => {
    const haystack = name.toLowerCase();

    if (haystack === needle) return 1000;
    if (haystack.startsWith(needle)) return 500;
    if (wordBoundary.test(haystack)) return 250;
    if (haystack.includes(needle)) return 100;
    if (multiToken && multiToken.every((token) => haystack.includes(token))) return 50;

    return 0;
  };
}

/**
 * Ranked substring search over exercise names.
 *
 * Deliberately not fuzzy: gym-goers type prefixes ("bench", "rdl"), and fuzzy
 * matching mostly produces confusing far-off hits. Word-prefix matches outrank
 * mid-word ones so "row" surfaces "Row (Cable)" above "Narrow Grip …".
 *
 * Scoring one name against one query. To score many names against the *same*
 * query — which is what every list screen does — use `createExerciseMatcher`
 * and reuse the result; this compiles the query afresh on each call.
 */
export function scoreExerciseMatch(name: string, query: string): number {
  const match = createExerciseMatcher(query);
  return match ? match(name) : 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
