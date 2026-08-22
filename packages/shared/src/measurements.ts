/**
 * Body measurements: what each one is, and the arithmetic that turns a column
 * of numbers into something worth opening.
 *
 * Storage units are the ones `units.ts` describes: kilograms for bodyweight,
 * percent for body fat, centimetres for every circumference, and everything
 * here takes and returns those. Display conversion happens at the edge, in the
 * three `…Display…` helpers at the bottom of the metadata section.
 *
 * The maths splits in two. The *series* half answers "is this moving, and how
 * fast", which is the only question a log of numbers is kept to answer; the
 * *composition* half derives the figures a tape measure implies but does not
 * state: BMI, body fat, lean mass, symmetry. Both are pure, so the app and the
 * server compute them identically.
 */

import {
  MEASUREMENT_KINDS,
  type MeasurementKind,
  type MeasurementUnit,
  type WeightUnit,
} from './types.ts';
import {
  formatWeight,
  fromDisplayMeasurement,
  fromDisplayWeight,
  toDisplayMeasurement,
  toDisplayWeight,
  trimZeros,
} from './units.ts';

// ---------------------------------------------------------------------------
// Kind metadata
// ---------------------------------------------------------------------------

/**
 * Which quantity a kind actually is, and therefore which unit preference and
 * which converter applies to it. Three of these rather than a unit string,
 * because "cm" is a display choice and this is not.
 */
export type MeasurementScale = 'weight' | 'percent' | 'length';

export const MEASUREMENT_GROUPS = ['composition', 'torso', 'arms', 'legs'] as const;
export type MeasurementGroup = (typeof MEASUREMENT_GROUPS)[number];

export const MEASUREMENT_GROUP_LABELS: Record<MeasurementGroup, string> = {
  composition: 'Composition',
  torso: 'Torso',
  arms: 'Arms',
  legs: 'Legs',
};

export interface MeasurementMeta {
  scale: MeasurementScale;
  group: MeasurementGroup;
  /**
   * Which limb, for the kinds that come in pairs. Drives the symmetry readout
   * and lets a pair be drawn as one row with two figures.
   */
  side?: 'left' | 'right';
  /** The other half of the pair. */
  counterpart?: MeasurementKind;
  /**
   * The range a real human body occupies, in storage units, generous at both
   * ends. This is a typo filter and nothing more. It exists so a waist entered
   * as 850 instead of 85 is caught at the keyboard rather than rescaling every
   * chart that includes it for the rest of the log. It is deliberately not a
   * judgement about any particular body.
   */
  min: number;
  max: number;
}

/**
 * The eight limb entries differ only in their range, so the four fields they
 * share are spelled once. Written out per kind they wrapped mid-object and the
 * one field that varies stopped being visible in the list.
 */
function arm(side: 'left' | 'right', counterpart: MeasurementKind) {
  return { scale: 'length', group: 'arms', side, counterpart } as const;
}

function leg(side: 'left' | 'right', counterpart: MeasurementKind) {
  return { scale: 'length', group: 'legs', side, counterpart } as const;
}

export const MEASUREMENT_KIND_META: Record<MeasurementKind, MeasurementMeta> = {
  bodyweight: { scale: 'weight', group: 'composition', min: 20, max: 400 },
  body_fat: { scale: 'percent', group: 'composition', min: 3, max: 70 },

  neck: { scale: 'length', group: 'torso', min: 20, max: 70 },
  shoulders: { scale: 'length', group: 'torso', min: 60, max: 200 },
  chest: { scale: 'length', group: 'torso', min: 50, max: 200 },
  waist: { scale: 'length', group: 'torso', min: 40, max: 200 },
  hips: { scale: 'length', group: 'torso', min: 50, max: 200 },

  left_bicep: { ...arm('left', 'right_bicep'), min: 15, max: 70 },
  right_bicep: { ...arm('right', 'left_bicep'), min: 15, max: 70 },
  left_forearm: { ...arm('left', 'right_forearm'), min: 15, max: 60 },
  right_forearm: { ...arm('right', 'left_forearm'), min: 15, max: 60 },

  left_thigh: { ...leg('left', 'right_thigh'), min: 25, max: 110 },
  right_thigh: { ...leg('right', 'left_thigh'), min: 25, max: 110 },
  left_calf: { ...leg('left', 'right_calf'), min: 20, max: 80 },
  right_calf: { ...leg('right', 'left_calf'), min: 20, max: 80 },
};

/**
 * The kinds in each group, in the order `MEASUREMENT_KINDS` declares them.
 *
 * Derived rather than written out a second time: a kind added to the list and
 * given metadata appears in its section with no third place to remember.
 */
export const MEASUREMENT_GROUP_KINDS: Record<MeasurementGroup, MeasurementKind[]> =
  MEASUREMENT_GROUPS.reduce(
    (groups, group) => {
      groups[group] = MEASUREMENT_KINDS.filter((kind) => MEASUREMENT_KIND_META[kind].group === group);
      return groups;
    },
    {} as Record<MeasurementGroup, MeasurementKind[]>,
  );

/**
 * Left/right pairs, left first, with the name of the thing being measured
 * rather than of either side. A symmetry readout needs all three strings and
 * assembling them at the call site got "Left Bicep vs Right Bicep".
 */
export interface MeasurementPair {
  label: string;
  left: MeasurementKind;
  right: MeasurementKind;
}

export const MEASUREMENT_PAIRS: MeasurementPair[] = [
  { label: 'Biceps', left: 'left_bicep', right: 'right_bicep' },
  { label: 'Forearms', left: 'left_forearm', right: 'right_forearm' },
  { label: 'Thighs', left: 'left_thigh', right: 'right_thigh' },
  { label: 'Calves', left: 'left_calf', right: 'right_calf' },
];

/**
 * What a first measuring session should cover.
 *
 * Fifteen fields is a form, not a habit: someone opening this for the first
 * time gets the eight that a training log actually reads back later, and the
 * rest stay one tap away.
 */
export const STARTER_MEASUREMENT_KINDS: MeasurementKind[] = [
  'bodyweight',
  'chest',
  'waist',
  'hips',
  'left_bicep',
  'right_bicep',
  'left_thigh',
  'right_thigh',
];

// ---------------------------------------------------------------------------
// Units, formatting and validation
// ---------------------------------------------------------------------------

/** The two display preferences every formatter here needs. */
export interface MeasurementUnitPreferences {
  weightUnit: WeightUnit;
  measurementUnit: MeasurementUnit;
}

/** The unit a kind is entered and shown in: "kg", "%" or "cm". */
export function measurementUnitLabel(
  kind: MeasurementKind,
  prefs: MeasurementUnitPreferences,
): string {
  switch (MEASUREMENT_KIND_META[kind].scale) {
    case 'weight':
      return prefs.weightUnit;
    case 'percent':
      return '%';
    case 'length':
      return prefs.measurementUnit;
  }
}

/** Storage value → the number shown in the user's units. */
export function toDisplayMeasurementValue(
  kind: MeasurementKind,
  stored: number,
  prefs: MeasurementUnitPreferences,
): number {
  switch (MEASUREMENT_KIND_META[kind].scale) {
    case 'weight':
      return toDisplayWeight(stored, prefs.weightUnit);
    case 'percent':
      return stored;
    case 'length':
      return toDisplayMeasurement(stored, prefs.measurementUnit);
  }
}

/** A number typed in the user's units → the storage value. */
export function fromDisplayMeasurementValue(
  kind: MeasurementKind,
  display: number,
  prefs: MeasurementUnitPreferences,
): number {
  switch (MEASUREMENT_KIND_META[kind].scale) {
    case 'weight':
      return fromDisplayWeight(display, prefs.weightUnit);
    case 'percent':
      return display;
    case 'length':
      return fromDisplayMeasurement(display, prefs.measurementUnit);
  }
}

/**
 * How much one press of a stepper moves the value, in display units.
 *
 * Tied to the unit rather than the kind: a tape reads to the half-centimetre
 * and a quarter-inch, and a scale to a tenth of a kilogram, which is two
 * tenths of a pound, near enough that rounding it to 0.2 keeps the figure short
 * without the stepper ever landing somewhere the scale could not have shown.
 */
export function measurementStep(kind: MeasurementKind, prefs: MeasurementUnitPreferences): number {
  switch (MEASUREMENT_KIND_META[kind].scale) {
    case 'weight':
      return prefs.weightUnit === 'kg' ? 0.1 : 0.2;
    case 'percent':
      return 0.1;
    case 'length':
      return prefs.measurementUnit === 'cm' ? 0.5 : 0.25;
  }
}

/**
 * Formats a stored value for display: "82.4 kg", "14.2 %", "39.5 cm".
 *
 * One decimal everywhere. A tape and a bathroom scale both read to a tenth, and
 * the second decimal a kg→lb conversion produces is arithmetic, not precision.
 */
export function formatMeasurementValue(
  kind: MeasurementKind,
  stored: number,
  prefs: MeasurementUnitPreferences,
  options: { withUnit?: boolean } = {},
): string {
  const { withUnit = true } = options;
  const scale = MEASUREMENT_KIND_META[kind].scale;

  // Weight goes through `formatWeight` so bodyweight is spelled the same way
  // here as it is on a set row and in a workout summary.
  if (scale === 'weight') return formatWeight(stored, prefs.weightUnit, { decimals: 1, withUnit });

  const text = trimZeros(toDisplayMeasurementValue(kind, stored, prefs).toFixed(1));
  if (!withUnit) return text;
  return `${text} ${measurementUnitLabel(kind, prefs)}`;
}

/**
 * A change, always carrying its sign: "+1.2 kg", "−0.5 cm", "0 kg".
 *
 * The minus is U+2212, not a hyphen. At the sizes these are printed a hyphen
 * sits high and short beside a tabular digit and reads as a dash between two
 * numbers rather than as the sign of one.
 */
export function formatMeasurementDelta(
  kind: MeasurementKind,
  delta: number,
  prefs: MeasurementUnitPreferences,
  options: { withUnit?: boolean } = {},
): string {
  const magnitude = formatMeasurementValue(kind, Math.abs(delta), prefs, options);
  if (isNegligibleChange(kind, delta, prefs)) return magnitude;
  return `${delta > 0 ? '+' : '−'}${magnitude}`;
}

/**
 * Whether a change is smaller than the display can show.
 *
 * Without this a delta that rounds to "0.0" still gets a sign printed on it,
 * and the row claims a direction it cannot evidence. Compared in display units
 * because that is where the rounding happens. 0.05 kg is invisible, and so is
 * the 0.11 lb it converts to.
 */
export function isNegligibleChange(
  kind: MeasurementKind,
  delta: number,
  prefs: MeasurementUnitPreferences,
): boolean {
  return Math.abs(toDisplayMeasurementValue(kind, delta, prefs)) < 0.05;
}

/** Whether a stored value falls inside the kind's plausible range. */
export function isPlausibleMeasurement(kind: MeasurementKind, stored: number): boolean {
  const { min, max } = MEASUREMENT_KIND_META[kind];
  return Number.isFinite(stored) && stored >= min && stored <= max;
}

/**
 * The plausible range in display units, for an error message that quotes the
 * numbers the user is actually typing.
 */
export function measurementRange(
  kind: MeasurementKind,
  prefs: MeasurementUnitPreferences,
): { min: number; max: number } {
  const { min, max } = MEASUREMENT_KIND_META[kind];
  return {
    min: toDisplayMeasurementValue(kind, min, prefs),
    max: toDisplayMeasurementValue(kind, max, prefs),
  };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export interface MeasurementPoint {
  /** Epoch milliseconds. */
  at: number;
  /** Storage units. */
  value: number;
}

export interface MeasurementStats {
  count: number;
  /** Oldest and newest readings in the series given. */
  first: MeasurementPoint;
  latest: MeasurementPoint;
  /** The reading before `latest`, for "since last time". Null on a lone entry. */
  previous: MeasurementPoint | null;
  lowest: MeasurementPoint;
  highest: MeasurementPoint;
  mean: number;
  /** `latest.value − first.value`. */
  change: number;
  /**
   * Least-squares slope × 7. Null when every reading lands on the same instant,
   * where a slope is undefined rather than zero.
   */
  changePerWeek: number | null;
  /**
   * The smoothed value at `latest.at`. What the series says, as opposed to
   * what the last reading said. See `smoothMeasurements`.
   */
  trend: number;
}

/** Ascending by time. Ties keep their original order, which is insertion order. */
export function sortMeasurements(points: readonly MeasurementPoint[]): MeasurementPoint[] {
  return [...points].sort((a, b) => a.at - b.at);
}

/**
 * Exponentially weighted trend, spaced by real time.
 *
 * Bodyweight swings a kilogram or two on water, salt and time of day, so the
 * newest reading is a poor estimate of where someone actually is: the classic
 * failure of a scale is that it makes a normal Tuesday look like a lost week.
 * A moving average over the last N *entries* is the usual fix and it is wrong
 * here, because entries are not evenly spaced: someone who weighs in daily and
 * then not for a month would have that month averaged against readings from
 * before it.
 *
 * So the weight decays by elapsed time instead. `halfLifeDays` is the gap at
 * which a new reading and the running trend count equally; a week is long
 * enough to absorb a heavy meal and short enough that a real cut still shows
 * within a fortnight.
 */
export function smoothMeasurements(
  points: readonly MeasurementPoint[],
  halfLifeDays = 7,
): MeasurementPoint[] {
  const sorted = sortMeasurements(points);
  if (sorted.length === 0) return [];

  const smoothed: MeasurementPoint[] = [{ at: sorted[0]!.at, value: sorted[0]!.value }];

  for (let index = 1; index < sorted.length; index++) {
    const point = sorted[index]!;
    const previous = smoothed[index - 1]!;

    const gapDays = Math.max(0, point.at - previous.at) / DAY_MS;
    // Two readings on the same morning are one weigh-in taken twice, not two
    // days of evidence, so a zero gap gives the new one no weight at all.
    const alpha = 1 - 2 ** (-gapDays / halfLifeDays);

    smoothed.push({ at: point.at, value: previous.value + alpha * (point.value - previous.value) });
  }

  return smoothed;
}

/**
 * Change per day, by least squares over time.
 *
 * First-to-last would be simpler and is what a two-point "change" already says;
 * the regression is here because it uses every reading, so one high day at
 * either end of the window cannot set the rate on its own.
 */
export function changePerDay(points: readonly MeasurementPoint[]): number | null {
  if (points.length < 2) return null;

  const meanAt = points.reduce((sum, point) => sum + point.at, 0) / points.length;
  const meanValue = points.reduce((sum, point) => sum + point.value, 0) / points.length;

  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.at - meanAt;
    covariance += dx * (point.value - meanValue);
    variance += dx * dx;
  }

  // Every reading at the same instant: a line through them is vertical, and no
  // rate exists to report.
  if (variance === 0) return null;

  return (covariance / variance) * DAY_MS;
}

export function summarizeMeasurements(
  points: readonly MeasurementPoint[],
): MeasurementStats | null {
  const sorted = sortMeasurements(points);
  if (sorted.length === 0) return null;

  const first = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;

  let lowest = first;
  let highest = first;
  let total = 0;

  for (const point of sorted) {
    if (point.value < lowest.value) lowest = point;
    if (point.value > highest.value) highest = point;
    total += point.value;
  }

  const perDay = changePerDay(sorted);
  const smoothed = smoothMeasurements(sorted);

  return {
    count: sorted.length,
    first,
    latest,
    previous: sorted.length > 1 ? sorted[sorted.length - 2]! : null,
    lowest,
    highest,
    mean: total / sorted.length,
    change: latest.value - first.value,
    changePerWeek: perDay === null ? null : perDay * 7,
    trend: smoothed[smoothed.length - 1]!.value,
  };
}

/** The readings inside the last `days`, oldest first. */
export function selectWindow(
  points: readonly MeasurementPoint[],
  days: number,
  now: number,
): MeasurementPoint[] {
  const cutoff = now - days * DAY_MS;
  return sortMeasurements(points).filter((point) => point.at >= cutoff);
}

/**
 * The reading that was standing at a given instant: the newest one at or
 * before it.
 *
 * This is what "change over the last 30 days" has to compare against, and it is
 * not the oldest reading inside the window. Someone who weighed in on the 1st
 * and again on the 29th has *one* reading in the last 30 days; measuring the
 * change from that reading to itself reports zero, when the honest answer is
 * the difference from the 1st. Null when the series starts inside the window,
 * where there is nothing to compare to and the caller should say "since" the
 * first entry instead.
 */
export function baselineAt(
  points: readonly MeasurementPoint[],
  at: number,
): MeasurementPoint | null {
  let baseline: MeasurementPoint | null = null;
  for (const point of sortMeasurements(points)) {
    if (point.at > at) break;
    baseline = point;
  }
  return baseline;
}

export interface MeasurementChange {
  from: MeasurementPoint;
  to: MeasurementPoint;
  delta: number;
  /** Whole days between the two readings, floored, never negative. */
  spanDays: number;
}

/**
 * The change over the last `days`, measured from whatever reading was standing
 * when the window opened. Falls back to the oldest reading when the log itself
 * is younger than the window. Null until there are two readings to compare.
 */
export function changeOverWindow(
  points: readonly MeasurementPoint[],
  days: number,
  now: number,
): MeasurementChange | null {
  const sorted = sortMeasurements(points);
  if (sorted.length < 2) return null;

  const latest = sorted[sorted.length - 1]!;
  const from = baselineAt(sorted, now - days * DAY_MS) ?? sorted[0]!;
  if (from === latest) return null;

  return {
    from,
    to: latest,
    delta: latest.value - from.value,
    spanDays: Math.max(0, Math.floor((latest.at - from.at) / DAY_MS)),
  };
}

/** Whole days between an instant and now, floored at zero. */
export function daysSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Body composition
// ---------------------------------------------------------------------------

/**
 * Used only by the US Navy body-fat estimate, which fits separate curves for
 * each and needs the hip measurement for one of them. Nothing else in the app
 * reads it, and it is optional. Leaving it unset costs that one estimate.
 */
export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

export const SEX_LABELS: Record<Sex, string> = {
  male: 'Male',
  female: 'Female',
};

/** Body mass index. Null unless both figures are present and sane. */
export function bodyMassIndex(weightKg: number, heightCm: number | null): number | null {
  if (heightCm == null || heightCm <= 0 || weightKg <= 0) return null;
  const metres = heightCm / 100;
  return weightKg / (metres * metres);
}

export type BmiBand = 'underweight' | 'healthy' | 'overweight' | 'obese';

export const BMI_BAND_LABELS: Record<BmiBand, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy range',
  overweight: 'Overweight',
  obese: 'Obese',
};

export function bmiBand(bmi: number): BmiBand {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'healthy';
  if (bmi < 30) return 'overweight';
  return 'obese';
}

/**
 * BMI cannot tell muscle from fat, and this app is used by people who are
 * deliberately adding the former. Anyone lifting seriously will read
 * "overweight" off a body that is nothing of the sort, so the figure ships with
 * the caveat attached rather than leaving the screen to remember it.
 */
export const BMI_CAVEAT =
  'BMI is weight against height alone. It counts muscle and fat the same. Waist-to-height and the body-fat estimate are the more useful pair here.';

export interface NavyBodyFatInput {
  sex: Sex;
  heightCm: number;
  neckCm: number;
  waistCm: number;
  /** Required for the female formula, unused by the male one. */
  hipCm?: number | null;
}

/**
 * Body fat percentage by the US Navy circumference method.
 *
 * A regression on tape measurements, accurate to roughly ±3–4 points against a
 * DEXA scan: worse than a lab and far better than nothing, and unlike a lab it
 * can be repeated every fortnight. What it is genuinely good at is *direction*:
 * the error is largely a constant offset for any one body, so the change over
 * months is more trustworthy than the absolute number.
 *
 * Returns null rather than a number whenever an input is missing or the
 * logarithms are undefined: a waist smaller than the neck, say, which is a
 * mis-entry rather than a body.
 */
export function navyBodyFatPercent(input: NavyBodyFatInput): number | null {
  const { sex, heightCm, neckCm, waistCm, hipCm } = input;
  if (!(heightCm > 0) || !(neckCm > 0) || !(waistCm > 0)) return null;

  let percent: number;

  if (sex === 'male') {
    const girth = waistCm - neckCm;
    if (girth <= 0) return null;
    percent =
      495 / (1.0324 - 0.19077 * Math.log10(girth) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (hipCm == null || !(hipCm > 0)) return null;
    const girth = waistCm + hipCm - neckCm;
    if (girth <= 0) return null;
    percent =
      495 / (1.29579 - 0.35004 * Math.log10(girth) + 0.221 * Math.log10(heightCm)) - 450;
  }

  if (!Number.isFinite(percent)) return null;

  // The regression is unbounded at both ends and produces negatives for lean
  // bodies with thick necks. Clamped to the range the metadata already calls
  // plausible rather than printing an impossible figure with a decimal on it.
  const { min, max } = MEASUREMENT_KIND_META.body_fat;
  return Math.min(max, Math.max(min, percent));
}

export function fatMassKg(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (bodyFatPercent / 100);
}

export function leanMassKg(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Waist divided by height.
 *
 * The single most useful number a tape measure produces, and the reason the
 * waist row is worth filling in: it tracks central fat, which is the part that
 * carries the health risk, and unlike BMI it does not mistake a squat session
 * for a problem. The guidance it comes from is the same in every population.
 * Keep your waist under half your height.
 */
export function waistToHeightRatio(waistCm: number, heightCm: number | null): number | null {
  if (heightCm == null || heightCm <= 0 || waistCm <= 0) return null;
  return waistCm / heightCm;
}

export type WaistBand = 'low' | 'healthy' | 'raised' | 'high';

export const WAIST_BAND_LABELS: Record<WaistBand, string> = {
  low: 'Below the healthy range',
  healthy: 'Healthy range',
  raised: 'Raised',
  high: 'High',
};

export function waistBand(ratio: number): WaistBand {
  if (ratio < 0.4) return 'low';
  if (ratio < 0.5) return 'healthy';
  if (ratio < 0.6) return 'raised';
  return 'high';
}

export function waistToHipRatio(waistCm: number, hipCm: number): number | null {
  if (waistCm <= 0 || hipCm <= 0) return null;
  return waistCm / hipCm;
}

export interface Symmetry {
  /** Absolute difference in storage units. */
  difference: number;
  /** That difference as a percentage of the larger side. */
  percent: number;
  larger: 'left' | 'right' | 'even';
}

/**
 * Left against right.
 *
 * Worth surfacing because the app already asks for both sides and then never
 * compared them, and because an arm that has been a centimetre behind for six
 * months is the kind of thing a unilateral accessory fixes, if you know. A
 * couple of points is ordinary human asymmetry, not an imbalance; the caller
 * decides where to draw that line, this only reports the gap.
 */
export function symmetry(leftValue: number, rightValue: number): Symmetry | null {
  if (!(leftValue > 0) || !(rightValue > 0)) return null;

  const difference = Math.abs(leftValue - rightValue);
  const larger = leftValue === rightValue ? 'even' : leftValue > rightValue ? 'left' : 'right';

  return {
    difference,
    percent: (difference / Math.max(leftValue, rightValue)) * 100,
    larger,
  };
}
