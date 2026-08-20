/**
 * What the measurement log implies, as opposed to what it stores.
 *
 * A tape measure and a scale produce numbers; almost everything worth knowing
 * is a *relationship* between them — a rate of change, a ratio, a gap between
 * two sides. The arithmetic lives in `@lift/shared`; this file decides which of
 * it applies to the data on hand, what it should be called, and what to ask for
 * when a figure is one input short.
 *
 * Kept out of the screens because both of them need it and because the decision
 * "can this be computed, and is it worth showing" is the part most likely to be
 * got wrong twice.
 */

import {
  MEASUREMENT_KIND_LABELS,
  MEASUREMENT_PAIRS,
  bmiBand,
  BMI_BAND_LABELS,
  bodyMassIndex,
  changeOverWindow,
  daysSince,
  fatMassKg,
  formatMeasurementDelta,
  formatMeasurementValue,
  formatWeight,
  isNegligibleChange,
  leanMassKg,
  navyBodyFatPercent,
  summarizeMeasurements,
  symmetry,
  trimZeros,
  waistBand,
  WAIST_BAND_LABELS,
  waistToHeightRatio,
  type MeasurementKind,
  type MeasurementStats,
  type MeasurementUnitPreferences,
  type Sex,
} from '@lift/shared';

import type { BodyMeasurement } from '@/db/schema';

import { toMeasurementPoints, type MeasurementLog } from './repository';

/** How many readings a row's sparkline draws. Older ones are off the shape. */
const SPARK_POINTS = 16;

/** A measurement is "current" for a month; past that the row says how stale it is. */
export const STALE_AFTER_DAYS = 30;

export interface KindSummary {
  kind: MeasurementKind;
  latest: BodyMeasurement;
  stats: MeasurementStats;
  /** Change against the reading before it. Null when this is the first. */
  sinceLast: number | null;
  /** Change over the last 30 days, measured from whatever was standing then. */
  sinceMonth: number | null;
  /** Recent values, oldest first, for a sparkline. */
  spark: number[];
  daysAgo: number;
}

export function summarizeKinds(log: MeasurementLog, now: number): Map<MeasurementKind, KindSummary> {
  const summaries = new Map<MeasurementKind, KindSummary>();

  for (const [kind, rows] of log) {
    if (rows.length === 0) continue;

    const points = toMeasurementPoints(rows);
    const stats = summarizeMeasurements(points);
    if (!stats) continue;

    const latest = rows[rows.length - 1]!;
    const month = changeOverWindow(points, 30, now);

    summaries.set(kind, {
      kind,
      latest,
      stats,
      sinceLast: stats.previous ? stats.latest.value - stats.previous.value : null,
      sinceMonth: month?.delta ?? null,
      spark: points.slice(-SPARK_POINTS).map((point) => point.value),
      daysAgo: daysSince(latest.measuredAt.getTime(), now),
    });
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

export interface BodyFigure {
  key: 'body_fat' | 'lean_mass' | 'bmi' | 'waist_height' | 'waist_hip';
  label: string;
  /** Display-ready, unit included. */
  value: string;
  /** What it means, or where it came from. */
  detail: string;
  /** True when the app worked the figure out rather than the user logging it. */
  estimated: boolean;
}

export interface BodyFigureInput {
  summaries: Map<MeasurementKind, KindSummary>;
  prefs: MeasurementUnitPreferences;
  heightCm: number | null;
  sex: Sex | null;
}

/**
 * Every composition figure the current data supports, most useful first.
 *
 * Nothing here is padded out with placeholders: a figure that cannot be
 * computed is absent, and `missingInputHint` says what to supply. A row reading
 * "Body fat —" is a worse answer than no row, because it looks like a
 * measurement of zero rather than an unanswered question.
 */
export function buildBodyFigures(input: BodyFigureInput): BodyFigure[] {
  const { summaries, prefs, heightCm } = input;
  const figures: BodyFigure[] = [];

  const weightKg = summaries.get('bodyweight')?.latest.value ?? null;
  const estimate = estimateBodyFat(input);
  const bodyFat = summaries.get('body_fat')?.latest.value ?? estimate;

  if (bodyFat != null) {
    figures.push({
      key: 'body_fat',
      label: 'Body fat',
      value: formatMeasurementValue('body_fat', bodyFat, prefs),
      detail:
        estimate != null && summaries.get('body_fat') == null
          ? 'Estimated from your neck, waist and height'
          : 'As logged',
      estimated: summaries.get('body_fat') == null,
    });

    if (weightKg != null) {
      figures.push({
        key: 'lean_mass',
        label: 'Lean mass',
        value: formatWeight(leanMassKg(weightKg, bodyFat), prefs.weightUnit, { decimals: 1 }),
        detail: `${formatWeight(fatMassKg(weightKg, bodyFat), prefs.weightUnit, {
          decimals: 1,
        })} of fat mass`,
        estimated: true,
      });
    }
  }

  const waistCm = summaries.get('waist')?.latest.value ?? null;

  if (waistCm != null) {
    const ratio = waistToHeightRatio(waistCm, heightCm);
    if (ratio != null) {
      figures.push({
        key: 'waist_height',
        label: 'Waist-to-height',
        value: ratio.toFixed(2),
        detail: WAIST_BAND_LABELS[waistBand(ratio)],
        estimated: true,
      });
    }
  }

  if (weightKg != null) {
    const bmi = bodyMassIndex(weightKg, heightCm);
    if (bmi != null) {
      figures.push({
        key: 'bmi',
        label: 'BMI',
        value: bmi.toFixed(1),
        // Not the band alone: this app is used by people deliberately adding
        // muscle, and BMI cannot tell that from fat. The reading is shown with
        // what it is measured against so it is read as one input rather than a
        // verdict.
        detail: `${BMI_BAND_LABELS[bmiBand(bmi)]} · weight against height only`,
        estimated: true,
      });
    }
  }

  return figures;
}

/** The Navy estimate, when every input it needs is on hand. */
function estimateBodyFat({ summaries, heightCm, sex }: BodyFigureInput): number | null {
  if (heightCm == null || sex == null) return null;

  const neckCm = summaries.get('neck')?.latest.value;
  const waistCm = summaries.get('waist')?.latest.value;
  if (neckCm == null || waistCm == null) return null;

  return navyBodyFatPercent({
    sex,
    heightCm,
    neckCm,
    waistCm,
    hipCm: summaries.get('hips')?.latest.value ?? null,
  });
}

/**
 * What the screen should offer to collect next: either a preference or a
 * measurement, so the row it renders can be a single tap into the right place.
 */
export type MissingInputHint =
  | { message: string; action: 'settings' }
  | { message: string; action: 'measure'; kind: MeasurementKind };

/**
 * The one thing worth asking for next, or null when nothing is missing.
 *
 * Ordered by how much each unlocks rather than by the order the formulas need
 * them: height alone brings back two figures, and asking for four things at
 * once is how a tracking screen turns into a form.
 */
export function missingInputHint(input: BodyFigureInput): MissingInputHint | null {
  const { summaries, heightCm, sex } = input;

  // Nothing logged at all is the empty state's problem, not a missing input.
  if (summaries.size === 0) return null;

  if (heightCm == null) {
    return {
      message: 'Add your height in Settings for BMI and waist-to-height.',
      action: 'settings',
    };
  }

  if (!summaries.has('waist')) {
    return {
      message: 'Log your waist for waist-to-height, the most useful number a tape gives.',
      action: 'measure',
      kind: 'waist',
    };
  }

  if (sex == null) {
    return {
      message: 'Set your sex in Settings to estimate body fat from your tape measurements.',
      action: 'settings',
    };
  }

  if (!summaries.has('neck')) {
    return {
      message: 'Log your neck to estimate body fat from your measurements.',
      action: 'measure',
      kind: 'neck',
    };
  }

  if (sex === 'female' && !summaries.has('hips')) {
    return {
      message: 'Log your hips to complete the body-fat estimate.',
      action: 'measure',
      kind: 'hips',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Symmetry
// ---------------------------------------------------------------------------

/** Past this, a side difference is worth naming rather than being noise. */
const SYMMETRY_THRESHOLD_PERCENT = 3;

export interface SymmetryNote {
  label: string;
  /** "Right 1.5 cm bigger" — already in display units. */
  summary: string;
  /** True once the gap is large enough to be worth training around. */
  notable: boolean;
}

/**
 * Left against right, for every pair with both sides logged.
 *
 * The app has asked for both arms and both legs since the first release and
 * then never compared them, which made half those fields busywork. A gap that
 * has held for months is the kind of thing a unilateral accessory fixes — but
 * only if someone puts the two numbers side by side.
 */
export function buildSymmetryNotes(
  summaries: Map<MeasurementKind, KindSummary>,
  prefs: MeasurementUnitPreferences,
): SymmetryNote[] {
  const notes: SymmetryNote[] = [];

  for (const pair of MEASUREMENT_PAIRS) {
    const left = summaries.get(pair.left)?.latest.value;
    const right = summaries.get(pair.right)?.latest.value;
    if (left == null || right == null) continue;

    const result = symmetry(left, right);
    if (!result) continue;

    if (result.larger === 'even') {
      notes.push({ label: pair.label, summary: 'Even', notable: false });
      continue;
    }

    const side = result.larger === 'left' ? 'Left' : 'Right';
    const gap = formatMeasurementValue(pair.left, result.difference, prefs);

    notes.push({
      label: pair.label,
      summary: `${side} +${gap} · ${trimZeros(result.percent.toFixed(1))}%`,
      notable: result.percent >= SYMMETRY_THRESHOLD_PERCENT,
    });
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** "12 days ago", "Today", "3 weeks ago" — how fresh a reading is. */
export function describeRecency(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * The rate a series is moving at, in words: "−0.4 kg per week".
 *
 * Null below two readings a week apart — a rate fitted to a couple of days of
 * data extrapolates a normal fluctuation into a trend, and printing it would
 * make the app confidently wrong about the thing people most want it to be
 * right about.
 */
export function describeRate(
  kind: MeasurementKind,
  stats: MeasurementStats,
  prefs: MeasurementUnitPreferences,
): string | null {
  if (stats.changePerWeek == null || stats.count < 3) return null;
  if (stats.latest.at - stats.first.at < 7 * 86_400_000) return null;

  const magnitude = formatMeasurementDelta(kind, stats.changePerWeek, prefs);
  return `${magnitude} per week`;
}

/** "Bodyweight, 82.4 kg, down 1.2 kg since last time" — one sentence per row. */
export function describeSummary(
  summary: KindSummary,
  prefs: MeasurementUnitPreferences,
): string {
  const value = formatMeasurementValue(summary.kind, summary.latest.value, prefs);
  const label = MEASUREMENT_KIND_LABELS[summary.kind];
  const recency = describeRecency(summary.daysAgo).toLowerCase();

  if (summary.sinceLast == null) return `${label}, ${value}, logged ${recency}`;

  // "Unchanged by 0 kg" is what a direction word plus a magnitude produces when
  // the magnitude is nothing, so that case gets its own sentence.
  if (isNegligibleChange(summary.kind, summary.sinceLast, prefs)) {
    return `${label}, ${value}, unchanged since the previous reading, logged ${recency}`;
  }

  const direction = summary.sinceLast > 0 ? 'up' : 'down';
  const delta = formatMeasurementValue(summary.kind, Math.abs(summary.sinceLast), prefs);

  return `${label}, ${value}, ${direction} ${delta} since the previous reading, logged ${recency}`;
}
