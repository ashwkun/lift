/**
 * Which units one exercise is shown in.
 *
 * The app-wide setting is a default, not a decision. A gym is not one unit: the
 * dumbbell rack is stamped in pounds, the plates on the next rack are kilos,
 * and a treadmill reports miles whatever the rest of the room does. So the unit
 * belongs to the movement — stored on the exercise row beside its rest override
 * — and the setting is what an exercise falls back to when the user has never
 * said anything about it.
 *
 * None of this touches storage. Weights are kept in kilograms and distances in
 * kilometres everywhere in the database, and every screen converts on the way
 * out and back on the way in. A unit is a rendering decision, which is exactly
 * why it can differ per exercise without anything having to be migrated.
 *
 * Two entry points on purpose. `useExerciseUnits` is for a screen that is about
 * one exercise; `resolveExerciseUnits` is for a screen that lists several and
 * therefore cannot call a hook per row.
 */

import type { DistanceUnit, WeightUnit } from '@lift/shared';

import { useSettings } from '@/store/settings';

/** A resolved pair — no nulls left, safe to hand to a formatter. */
export interface DisplayUnits {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}

/**
 * The columns this reads, rather than the whole `Exercise`.
 *
 * A list screen usually selects a projection of the exercise row (see
 * `ExerciseListItem`), and asking for the full type here would force those
 * queries to widen to satisfy a function that looks at two fields.
 */
export interface ExerciseUnitOverrides {
  weightUnit: WeightUnit | null;
  distanceUnit: DistanceUnit | null;
}

/** The app-wide pair, for the totals and lists that span exercises. */
export function useAppUnits(): DisplayUnits {
  const weightUnit = useSettings((state) => state.weightUnit);
  const distanceUnit = useSettings((state) => state.distanceUnit);

  return { weightUnit, distanceUnit };
}

/**
 * The units for one exercise: its own where it has an opinion, the app's where
 * it does not.
 *
 * Null is the whole mechanism. It is not "kilograms", it is "nobody has said",
 * which is what lets someone flip the app-wide setting and have every exercise
 * they never spoke for follow along — while the two they set in pounds stay in
 * pounds, because those were choices.
 */
export function resolveExerciseUnits(
  exercise: ExerciseUnitOverrides | null | undefined,
  appWide: DisplayUnits,
): DisplayUnits {
  return {
    weightUnit: exercise?.weightUnit ?? appWide.weightUnit,
    distanceUnit: exercise?.distanceUnit ?? appWide.distanceUnit,
  };
}

/** `resolveExerciseUnits` against the current settings. */
export function useExerciseUnits(exercise: ExerciseUnitOverrides | null | undefined): DisplayUnits {
  return resolveExerciseUnits(exercise, useAppUnits());
}
