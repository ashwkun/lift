/**
 * Plate calculator — "what do I actually load on the bar for 102.5 kg?"
 */

import type { WeightUnit } from './types.ts';

export interface PlateSpec {
  /** Plate denomination, in kilograms (storage unit). */
  weightKg: number;
  /** How many of this plate the user owns *in total*, not per side. */
  count: number;
}

export interface LoadedPlate {
  weightKg: number;
  /** Plates of this size to put on **each** side. */
  perSide: number;
}

export interface PlateResult {
  plates: LoadedPlate[];
  /** Weight actually achievable with the available plates. */
  achievedKg: number;
  /** Target minus achieved. Non-zero means the target isn't loadable. */
  remainderKg: number;
  exact: boolean;
  /** Set when the target is below the bar itself. */
  belowBar: boolean;
}

/** Plates found in a typical kg gym. */
export const DEFAULT_PLATES_KG: PlateSpec[] = [
  { weightKg: 25, count: 8 },
  { weightKg: 20, count: 8 },
  { weightKg: 15, count: 4 },
  { weightKg: 10, count: 4 },
  { weightKg: 5, count: 4 },
  { weightKg: 2.5, count: 4 },
  { weightKg: 1.25, count: 4 },
];

/** Plates found in a typical lb gym, expressed in kg for storage consistency. */
export const DEFAULT_PLATES_LB: PlateSpec[] = [
  { weightKg: 20.4117, count: 8 }, // 45 lb
  { weightKg: 15.8757, count: 4 }, // 35 lb
  { weightKg: 11.3398, count: 4 }, // 25 lb
  { weightKg: 4.5359, count: 4 }, // 10 lb
  { weightKg: 2.2679, count: 4 }, // 5 lb
  { weightKg: 1.1339, count: 4 }, // 2.5 lb
];

export const DEFAULT_BAR_KG = 20;
export const DEFAULT_BAR_LB_IN_KG = 20.4117; // 45 lb

export function defaultPlates(unit: WeightUnit): PlateSpec[] {
  return unit === 'kg' ? DEFAULT_PLATES_KG : DEFAULT_PLATES_LB;
}

export function defaultBarKg(unit: WeightUnit): number {
  return unit === 'kg' ? DEFAULT_BAR_KG : DEFAULT_BAR_LB_IN_KG;
}

/**
 * Works out the plate loading for a target weight.
 *
 * Greedy heaviest-first, which is provably optimal for real plate sets because
 * each denomination divides evenly into the ones above it. It also matches what
 * lifters actually do — nobody loads 102.5 kg as eight 5s and a 2.5.
 *
 * Plates are placed in pairs; an odd plate can't be balanced on a barbell, so
 * the per-side count is what we solve for.
 */
export function calculatePlates(
  targetKg: number,
  barKg: number,
  inventory: readonly PlateSpec[] = DEFAULT_PLATES_KG,
): PlateResult {
  if (targetKg < barKg) {
    return {
      plates: [],
      achievedKg: barKg,
      remainderKg: targetKg - barKg,
      exact: false,
      belowBar: true,
    };
  }

  // Solve one side; the bar is symmetric.
  let remainingPerSide = (targetKg - barKg) / 2;

  const sorted = [...inventory].sort((a, b) => b.weightKg - a.weightKg);
  const plates: LoadedPlate[] = [];

  for (const spec of sorted) {
    if (remainingPerSide < spec.weightKg) continue;

    const pairsOwned = Math.floor(spec.count / 2);
    if (pairsOwned === 0) continue;

    const wanted = Math.floor(remainingPerSide / spec.weightKg + EPSILON);
    const perSide = Math.min(wanted, pairsOwned);
    if (perSide === 0) continue;

    plates.push({ weightKg: spec.weightKg, perSide });
    remainingPerSide -= perSide * spec.weightKg;
  }

  const achievedKg = barKg + plates.reduce((sum, p) => sum + p.weightKg * p.perSide * 2, 0);
  const remainderKg = targetKg - achievedKg;

  return {
    plates,
    achievedKg,
    remainderKg,
    exact: Math.abs(remainderKg) < EPSILON,
    belowBar: false,
  };
}

// Floating-point slack. Plate maths in lb-converted-to-kg produces values like
// 20.411699999999996, and a naive comparison would drop a plate.
const EPSILON = 1e-6;

/**
 * The nearest weights *below and above* a target that are actually loadable.
 * Used to suggest a correction when the entered weight can't be made.
 */
export function nearestLoadable(
  targetKg: number,
  barKg: number,
  inventory: readonly PlateSpec[] = DEFAULT_PLATES_KG,
): { below: number; above: number } {
  const smallest = [...inventory]
    .filter((p) => p.count >= 2)
    .sort((a, b) => a.weightKg - b.weightKg)[0];

  const step = smallest ? smallest.weightKg * 2 : 1;
  const below = calculatePlates(targetKg, barKg, inventory).achievedKg;

  return { below, above: below + step };
}
