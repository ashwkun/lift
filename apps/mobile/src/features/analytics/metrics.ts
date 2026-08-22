/**
 * The three totals a finished session carries, and how each one is read.
 *
 * Volume, duration and reps are the only measures stored on `workouts` itself
 * rather than derived from a join, which is why these three and not, say, sets
 * per muscle: any bucket of sessions can be re-plotted in another of them with
 * no second query. Home and History both offer the switch and both read this
 * table, so a metric is defined once: its label in the tabs, which field it
 * pulls, and its two renderings.
 *
 * The two renderings are not interchangeable. `format` is the figure a person
 * reads ("12,431 kg"), and `axis` is the same quantity in a 46px gutter under
 * a chart ("12.4k"). Handing the readout formatter to an axis is how a chart
 * ends up with its ticks clipped, and it is not a hypothetical: the gutter is
 * narrower than the string in every metric here except reps.
 */

import { formatDurationShort, formatVolume, type WeightUnit } from '@lift/shared';

export type TrendMetric = 'volume' | 'duration' | 'reps';

/**
 * Anything carrying a session's three totals.
 *
 * Structural on purpose: `WeeklyPoint` and `TrendBucket` both satisfy it
 * without either of them naming this type, which is what lets one metric
 * definition serve two screens that bucket their sessions differently.
 */
export interface MetricTotals {
  volumeKg: number;
  durationSeconds: number;
  reps: number;
}

export const METRIC: Record<
  TrendMetric,
  {
    /** Names it in the tabs, and again in the sentence above Home's figure. */
    label: string;
    pick: (totals: MetricTotals) => number;
    /** The figure, with its unit. For a readout or a headline. */
    format: (value: number, unit: WeightUnit) => string;
    /** The same value for a chart's axis gutter, which is 44pt. Unitless. */
    axis: (value: number, unit: WeightUnit) => string;
  }
> = {
  volume: {
    label: 'Volume',
    pick: (totals) => totals.volumeKg,
    format: (value, unit) => formatVolume(value, unit),
    axis: (value, unit) => formatVolume(value, unit).replace(` ${unit}`, ''),
  },
  duration: {
    label: 'Duration',
    pick: (totals) => totals.durationSeconds,
    format: (value) => formatDurationShort(value),
    // Whole hours past the hour mark. `formatDurationShort` would give "2h 14m"
    // here, which is three glyphs too many for the gutter and a precision no
    // axis label is read to.
    axis: (value) => (value >= 3600 ? `${Math.round(value / 3600)}h` : `${Math.round(value / 60)}m`),
  },
  reps: {
    label: 'Reps',
    pick: (totals) => totals.reps,
    format: (value) => `${Math.round(value).toLocaleString()} reps`,
    axis: (value) =>
      value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value)),
  },
};

/**
 * The tab options, in the order the tabs draw them.
 *
 * Derived from `METRIC` rather than written out beside it, so a metric has one
 * label wherever it appears. The order is the array below and not the object's
 * key order: volume first because it is what the app is about and what Home
 * opens on, then the two ways of checking it.
 */
export const TREND_METRICS: readonly { value: TrendMetric; label: string }[] = (
  ['volume', 'duration', 'reps'] as const
).map((value) => ({ value, label: METRIC[value].label }));
