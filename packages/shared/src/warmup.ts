/**
 * The sets you do before the set that counts.
 *
 * Every number a warm-up needs is already in this app and none of it is joined
 * up: the working weight is in the set row, the bar is in Settings, and the
 * plate inventory sits next to an optimal greedy solver in `plates.ts`. The
 * lifter still types four rows by hand at the rack. This module is the join,
 * and it is pure for the reason `progression.ts` gives one file over: the same
 * arithmetic has to run inside a render, inside a test, and eventually inside
 * a routine editor, with no database anywhere near it.
 *
 * One rule decides everything here:
 *
 * > **Every rung is a weight the lifter can actually load, and every rung is
 * > lighter than the set it prepares for.**
 *
 * The percentage table is the trivial half. Snapping is the feature: 40% of
 * 102.5 kg is 41, which is not a thing anybody can put on a bar, and a ramp
 * that prints it has handed the arithmetic back to the person it was supposed
 * to take it away from. So no rung leaves here until `calculatePlates` has
 * confirmed the plates for it exist, and a rung the plates cannot make is
 * either moved to one they can or dropped entirely.
 *
 * Dropped, not repeated, is the trade-off, and it was the close call. The
 * alternative was always emitting the style's full set count and letting the
 * weights collide, so a ramp is the same shape on every lift. That writes two
 * identical rows and calls them a progression, and a user reading 60 / 60 / 80
 * has to work out whether their rack is short of plates or the app is broken. A
 * ramp that is honestly two rungs long on a sparse rack beats one that is three
 * rungs long and lying about one of them.
 */

import {
  DEFAULT_BAR_KG,
  DEFAULT_PLATES_KG,
  calculatePlates,
  nearestLoadable,
  type PlateSpec,
} from './plates.ts';
import { defaultIncrementKg } from './progression.ts';
import { TRACKING_FIELDS, USES_BODYWEIGHT, type Equipment, type TrackingType } from './types.ts';
import { roundToIncrement } from './units.ts';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const WARMUP_STYLES = ['quick', 'standard', 'thorough'] as const;
export type WarmupStyle = (typeof WARMUP_STYLES)[number];

/** One entry in a style's table: a share of the working weight, and reps at it. */
interface WarmupRung {
  fraction: number;
  reps: number;
}

/**
 * The three tables, and why these numbers.
 *
 * `standard` is Wendler's warm-up with the rep count of the room rather than of
 * the book: 40 / 60 / 80 percent is what a 5/3/1 template prescribes and what
 * most lifters do without being told, because on a 20 kg bar and a 100 kg squat
 * it is three plate changes and every one of them is a round number.
 *
 * `quick` is the second and third exercise of a session. The body is already
 * warm by then and the ramp is only there to find the groove of a new movement,
 * so two rungs do it and a third is just fatigue spent before the working sets.
 *
 * `thorough` is the heavy single: five rungs, finishing at 90% for one rep,
 * which is the last rehearsal of the exact bar path before it matters. Nobody
 * needs this for an accessory and everybody wants it for a max attempt.
 *
 * The reps fall as the load rises, which is the whole point of a taper. A set
 * of eight at 80% is not a warm-up, it is a working set that will be paid for
 * by the one after it. Load goes up so the tissue is ready; reps come down so
 * the readiness is not spent getting there.
 *
 * Fractions stay strictly below 1 by construction: a rung at 100% is the
 * working set, and this module has no business writing that row.
 */
const RAMPS: Record<WarmupStyle, readonly WarmupRung[]> = {
  quick: [
    { fraction: 0.5, reps: 5 },
    { fraction: 0.8, reps: 3 },
  ],
  standard: [
    { fraction: 0.4, reps: 8 },
    { fraction: 0.6, reps: 5 },
    { fraction: 0.8, reps: 3 },
  ],
  thorough: [
    { fraction: 0.3, reps: 10 },
    { fraction: 0.45, reps: 8 },
    { fraction: 0.6, reps: 5 },
    { fraction: 0.75, reps: 3 },
    { fraction: 0.9, reps: 1 },
  ],
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface WarmupInput {
  /** The load of the first working set, in kilograms. */
  workingKg: number;
  /**
   * Reps of that working set, when they are known.
   *
   * Only ever caps the taper, never raises it: see `taperedReps`. Optional
   * because a session being planned often has a weight typed and no reps yet,
   * and the ramp is still the same ramp.
   */
  workingReps?: number | null;
  /** Empty bar weight, for barbell lifts. Ignored by every other equipment. */
  barKg?: number;
  /** What is on the shelf. Defaults to a typical kg gym, like `calculatePlates`. */
  inventory?: readonly PlateSpec[];
  trackingType: TrackingType;
  /** Decides how a rung is snapped: plate maths, or the rack's own step. */
  equipment?: Equipment;
  style?: WarmupStyle;
}

/** One rung: a row the caller can write as a `warmup` set and nothing more. */
export interface WarmupSet {
  /** Loadable, and strictly below the working weight. Kilograms. */
  weightKg: number;
  reps: number;
  /**
   * The share of the working weight this rung *asked* for, from the style
   * table. What it got is `weightKg`, and the two differ by however much the
   * plates on the shelf forced them to: that difference is the reason this
   * field is reported rather than recomputed by a caller who would get the
   * achieved fraction and think it was the intended one.
   */
  fraction: number;
}

/**
 * Why a ramp came back empty.
 *
 * Never a thrown error. A screen asking "is there a warm-up for this?" is
 * asking something that legitimately answers no, and five of the eight tracking
 * types in this app answer no by construction. An exception would make the
 * common case the exceptional one, and would take the logging screen down over
 * a plank.
 */
export type WarmupSkip =
  /**
   * Not logged as weight times reps, so there is no rung to build: a plank has
   * no load to halve, a 5 km run has no reps to taper, and a farmer's walk
   * carries a weight but records a distance.
   */
  | 'tracking_type'
  /**
   * The load is mostly the lifter. See the note on the `USES_BODYWEIGHT` check
   * in `buildWarmupRamp` for why scaling the *added* weight is wrong in one
   * direction and backwards in the other.
   */
  | 'bodyweight'
  /** No working weight to take a share of: null, zero, negative or not finite. */
  | 'no_working_weight'
  /**
   * Nothing loadable sits below the working weight. The bar is already as light
   * as this lift gets, or the plates cannot make anything lighter, or the
   * equipment has no load step at all (a band's next size up is a different
   * exercise, not a heavier version of this one).
   */
  | 'unloadable';

export interface WarmupRamp {
  /** The style actually used, so a caller that passed nothing can print it. */
  style: WarmupStyle;
  /** In ascending weight order. Empty exactly when `skipped` is set. */
  sets: WarmupSet[];
  skipped: WarmupSkip | null;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Float slack, matching `plates.ts`. Plate maths in lb-converted-to-kg lands on
 * values like 40.823399999999996, and the duplicate check below has to call
 * that equal to 40.8234 or a sparse lb rack emits the same rung twice.
 */
const EPSILON = 1e-6;

/**
 * The ramp for one working set.
 *
 * Kilograms in, kilograms out, and the caller converts for display: the same
 * contract every other module in this package keeps, and the reason a lifter in
 * pounds gets a ramp built from their own 45s rather than from a 20 kg bar
 * translated after the fact.
 */
export function buildWarmupRamp(input: WarmupInput): WarmupRamp {
  const style = input.style ?? 'standard';
  const skip = (skipped: WarmupSkip): WarmupRamp => ({ style, sets: [], skipped });

  const fields = TRACKING_FIELDS[input.trackingType];
  if (!fields.weight || !fields.reps) return skip('tracking_type');

  /*
   * Weighted and assisted bodyweight lifts are refused rather than approximated.
   *
   * The number in the weight column of a weighted pull-up is what was hung off
   * the belt, not what was lifted: the real load is bodyweight plus that, so
   * halving the 20 kg on the belt does not halve the effort, it shaves about a
   * tenth off it. Taking the percentage off the true load would need the
   * lifter's bodyweight, which is not an input here and is not on the set row
   * either (see the note on `USES_BODYWEIGHT` in `types.ts`).
   *
   * Assisted dips are worse than merely imprecise, they are inverted: the
   * column holds how much help the machine gave, so scaling it *down* toward a
   * warm-up makes every rung harder than the working set. A ramp that walks the
   * wrong way is the exact trust failure this feature exists to avoid, so the
   * honest answer is no ramp.
   */
  if (USES_BODYWEIGHT.has(input.trackingType)) return skip('bodyweight');

  const workingKg = input.workingKg;
  if (!Number.isFinite(workingKg) || workingKg <= 0) return skip('no_working_weight');

  const equipment = input.equipment ?? 'barbell';
  const barKg = input.barKg ?? DEFAULT_BAR_KG;
  const inventory = input.inventory ?? DEFAULT_PLATES_KG;

  /*
   * Plate maths for a barbell, the rack's own step for everything else.
   *
   * Only `barbell` gets `calculatePlates`, and that includes leaving the Smith
   * machine out, for the same reason the plate line on the logging screen
   * leaves it out: its counterbalance runs from 0 to 20 kg between machines, so
   * a confident per-side loading would be wrong more often than right. Snapping
   * a Smith rung to 2.5 kg instead still gives a usable number while claiming
   * nothing about what goes on the bar.
   *
   * A dumbbell has no per-side arithmetic at all. The rack is a ladder, and
   * `defaultIncrementKg` already tabulates the rung spacing of every piece of
   * equipment in the app, so there is nothing to invent here.
   */
  const snap =
    equipment === 'barbell'
      ? (targetKg: number) => snapToPlates(targetKg, barKg, inventory, workingKg)
      : rackSnapper(equipment, workingKg);

  if (!snap) return skip('unloadable');

  const sets: WarmupSet[] = [];

  for (const rung of RAMPS[style]) {
    const weightKg = snap(workingKg * rung.fraction);
    if (weightKg == null) continue;

    // The one filter, doing two jobs. A rung has to clear the one before it, so
    // a sparse rack that snapped two targets onto the same plates contributes
    // one row rather than two identical ones; and it has to stay under the
    // working weight, which is what keeps the top rung of `thorough` from
    // becoming the working set on a rack whose smallest pair is coarse.
    //
    // Ordering is enforced rather than assumed. Greedy plate selection is
    // monotone for any real plate set, but "real" is doing work in that
    // sentence, and a user-entered inventory of 7s and 5s is one row in a
    // future settings screen away. A ramp that steps backwards is worse than a
    // ramp with a rung missing.
    const previous = sets[sets.length - 1];
    if (previous && weightKg <= previous.weightKg + EPSILON) continue;
    if (weightKg >= workingKg - EPSILON) continue;

    sets.push({
      weightKg,
      reps: taperedReps(rung.reps, input.workingReps),
      fraction: rung.fraction,
    });
  }

  if (sets.length === 0) return skip('unloadable');

  return { style, sets, skipped: null };
}

/**
 * A rung's reps, capped by the working set's own.
 *
 * Only ever downward. Warming up for a heavy triple with a set of ten is not a
 * warm-up, it is the workout: the ramp is there to raise tissue temperature and
 * rehearse the bar path, and past about five reps it starts spending the set it
 * was meant to prepare. The reverse cap was considered and rejected, because
 * somebody working in sets of twenty does not want a twenty-rep warm-up at 40%,
 * they want the same short ramp everybody else gets.
 *
 * Never below one, which is only reachable if a caller passes zero or a
 * fraction, and a set of no reps is not a set.
 */
function taperedReps(reps: number, workingReps: number | null | undefined): number {
  if (workingReps == null || !Number.isFinite(workingReps)) return reps;
  return Math.max(1, Math.min(reps, Math.floor(workingReps)));
}

/**
 * The loadable weight nearest a rung, on a barbell.
 *
 * `calculatePlates` always rounds *down*, which is the right default for a
 * warm-up and the wrong only option: a rack holding nothing under 20 kg drags
 * the 40% and 60% rungs of a 100 kg squat both onto the empty bar, and after
 * the duplicate filter the ramp has stopped ramping. So the loadable weight
 * above is considered too, and taken when it sits closer to what the rung asked
 * for. A warm-up 2.5 kg heavier than intended is fine. One heavier than the
 * working set is not, which is the ceiling check.
 *
 * `nearestLoadable` derives its upper bound by adding the smallest pair on the
 * shelf to the lower one, which quietly assumes that pair has not already been
 * spent getting there. Usually true, not always, so the candidate goes back
 * through `calculatePlates` before it is believed. Returning a loading nobody
 * can make is the one outcome this module exists to prevent.
 *
 * Below the bar the answer is the bar. `calculatePlates` reports that case as
 * `belowBar` with the bar as the achieved weight, and an empty-bar set is
 * exactly what a lifter does for the first rung of a light lift anyway.
 */
function snapToPlates(
  targetKg: number,
  barKg: number,
  inventory: readonly PlateSpec[],
  ceilingKg: number,
): number {
  const down = calculatePlates(targetKg, barKg, inventory);
  if (down.exact || down.belowBar) return down.achievedKg;

  const { above } = nearestLoadable(targetKg, barKg, inventory);
  if (above >= ceilingKg) return down.achievedKg;
  if (above - targetKg >= targetKg - down.achievedKg) return down.achievedKg;

  return calculatePlates(above, barKg, inventory).exact ? above : down.achievedKg;
}

/**
 * The same job for everything that is not a barbell: snap to the smallest step
 * the equipment has, and refuse when it has none.
 *
 * Null rather than a snapper means "this equipment does not step", which
 * `defaultIncrementKg` reports as a zero: bands, straps and cardio machines
 * have no ladder to walk down. Falling back to 2.5 kg there would print a load
 * for a piece of equipment that has no loads, so the ramp is skipped instead.
 *
 * The per-rung null is the light end of a real ladder. There is no 0 kg
 * dumbbell, so a rung under one full increment has nothing to stand on.
 */
function rackSnapper(
  equipment: Equipment,
  ceilingKg: number,
): ((targetKg: number) => number | null) | null {
  const incrementKg = defaultIncrementKg(equipment);
  if (incrementKg <= 0) return null;

  return (targetKg: number) => {
    let snapped = roundToIncrement(targetKg, incrementKg);
    // Rounding to nearest can land on or past the working set, which no rung
    // may do. One step back is always still a rung, or it is nothing.
    if (snapped >= ceilingKg - EPSILON) snapped -= incrementKg;
    return snapped >= incrementKg - EPSILON ? snapped : null;
  };
}
