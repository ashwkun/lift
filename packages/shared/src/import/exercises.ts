/**
 * Matching imported exercise names to the library, and describing the ones that
 * miss.
 *
 * Both halves are pure so they can be tested, but only the first is interesting:
 * an import that fails to recognise "Bench Press (Barbell)" as the catalog's
 * bench press creates a duplicate custom exercise, and from then on the user's
 * history is split across two rows that no screen will ever add back together.
 */

import type { Equipment, TrackingType } from '../types.ts';
import type { ImportedSet } from './parse.ts';

/**
 * A name reduced to something two apps can agree on.
 *
 * The three differences that actually show up between catalogs are word order
 * ("Barbell Bench Press" against "Bench Press (Barbell)"), punctuation
 * ("Bent-Over Row", "Seated Row - V Grip") and plurals ("Push Ups"). Sorting
 * the tokens handles the first, stripping non-letters the second, and a
 * conservative singular the third. Conservative because it only has to be
 * *consistent*, not correct: both sides run through the same function, so
 * "triceps" collapsing to "tricep" matches as long as it always does.
 *
 * Nothing here is fuzzy. A near-miss creating a custom exercise is a row the
 * user can see and merge; a fuzzy hit filing squats under front squats is a
 * silent corruption of their history.
 */
export function exerciseMatchKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular);

  return [...new Set(tokens)].sort().join(' ');
}

/** `curls` → `curl`, but `press` and `cross` are left alone. */
function singular(token: string): string {
  // Three letters is not too short to matter: `ups` is the second half of the
  // most common bodyweight exercise there is.
  if (token.length <= 2) return token;
  if (token.endsWith('ss') || token.endsWith('us') || token.endsWith('is')) return token;
  return token.endsWith('s') ? token.slice(0, -1) : token;
}

// ---------------------------------------------------------------------------
// Describing an unmatched exercise
// ---------------------------------------------------------------------------

/**
 * Equipment names as they appear in exercise titles, longest first.
 *
 * Longest first is what makes "Smith Machine Row" a smith machine rather than a
 * machine. A plain `Object.entries` walk would hit whichever key came first.
 */
const EQUIPMENT_WORDS: [string, Equipment][] = [
  ['smith machine', 'smith_machine'],
  ['resistance band', 'resistance_band'],
  ['medicine ball', 'medicine_ball'],
  ['cardio machine', 'cardio_machine'],
  ['weight plate', 'plate'],
  ['bodyweight', 'bodyweight'],
  ['kettlebell', 'kettlebell'],
  ['suspension', 'suspension'],
  ['dumbbell', 'dumbbell'],
  ['barbell', 'barbell'],
  ['machine', 'machine'],
  ['med ball', 'medicine_ball'],
  ['smith', 'smith_machine'],
  ['cable', 'cable'],
  ['plate', 'plate'],
  ['band', 'resistance_band'],
  ['trx', 'suspension'],
];

/**
 * The equipment an exercise title admits to, or `other`.
 *
 * Hevy and Lyfta both suffix the equipment in parentheses, so this is right far
 * more often than it looks, and when it is wrong the cost is one field on a
 * custom exercise the user can edit, not a mis-filed set.
 */
export function inferEquipment(name: string): Equipment {
  const text = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

  for (const [word, equipment] of EQUIPMENT_WORDS) {
    if (text.includes(word)) return equipment;
  }

  return 'other';
}

/**
 * What the sets say the exercise measures.
 *
 * This is the single most consequential field on a created exercise: it decides
 * which inputs the set row renders and how volume is derived, so getting it
 * wrong means the logger asks for a weight on a plank forever after.
 *
 * The rule that earns its keep is the last one about weights. A weight column
 * full of zeroes is an exporter saying "this is a bodyweight movement".
 * Hevy writes exactly that for push-ups, whereas *no* weight column at all
 * says nothing, and guessing bodyweight there would value every set at the
 * lifter's weight on no evidence. That case gets `reps_only`, which counts the
 * reps and claims no volume.
 */
export function inferTrackingType(name: string, sets: readonly ImportedSet[]): TrackingType {
  const hasReps = sets.some((set) => set.reps !== null);
  const hasDuration = sets.some((set) => set.durationSeconds !== null);
  const hasDistance = sets.some((set) => set.distanceKm !== null);
  const hasWeightColumn = sets.some((set) => set.weightKg !== null);
  const hasLoad = sets.some((set) => (set.weightKg ?? 0) > 0);

  if (hasDistance) {
    if (hasLoad) return 'weight_distance';
    return 'distance_duration';
  }

  const text = name.toLowerCase();
  if (hasReps && text.includes('assisted')) return 'assisted_bodyweight';
  if (hasReps && (text.includes('weighted') || inferEquipment(name) === 'bodyweight')) {
    return hasLoad ? 'weighted_bodyweight' : 'bodyweight_reps';
  }

  if (hasReps && hasLoad) return 'weight_reps';
  if (hasReps && hasWeightColumn) return 'bodyweight_reps';
  if (hasReps) return 'reps_only';
  if (hasDuration) return 'duration';

  return 'weight_reps';
}
