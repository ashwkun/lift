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

export * from './matching.ts';
export * from './ranking.ts';
