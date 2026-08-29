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

import { formatDurationShort, formatVolume, toDisplayWeight, type WeightUnit } from '@lift/shared';

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
    /**
     * Which of the palette's six category hues this metric is drawn in.
     *
     * An index into `Palette['data']` rather than a colour, because the answer
     * has to be different in every theme and a hex here would be one theme's
     * answer written into a file that has no theme. See `data` in the tokens
     * for what the ramp is and why index 0 is the accent.
     *
     * It lives beside `label` and `format` because it is the same kind of fact:
     * part of how a metric is *presented*, fixed once so that Home's figure,
     * History's chart and anything added later cannot disagree about what
     * colour duration is. A metric that changed hue between two screens would
     * be worse than one with no hue at all, because the colour would be
     * actively saying the two are different things.
     */
    tone: 0 | 1 | 2 | 3 | 4 | 5;
  }
> = {
  volume: {
    label: 'Volume',
    // The accent, which is what the ramp's index 0 always is. Volume is the
    // subject of this app, so it gets the colour the app is *about* and the two
    // checks below it get colours of their own.
    tone: 0,
    pick: (totals) => totals.volumeKg,
    format: (value, unit) => formatVolume(value, unit),
    // Not `formatVolume` with the unit stripped, which is what this was. That
    // gives "25,000" for an ordinary week's ceiling: six glyphs and two of them
    // punctuation, in a gutter that fits four. It did not wrap, it truncated,
    // so the axis read "25,00" and the chart was quietly labelled with a number
    // that does not exist. Thousands are abbreviated instead.
    axis: (value, unit) => compact(toDisplayWeight(value, unit)),
  },
  duration: {
    label: 'Duration',
    // Blue, which is where Apple's Fitness app puts distance: the metric that
    // is a measure of how far the session went rather than of how hard it was.
    tone: 4,
    pick: (totals) => totals.durationSeconds,
    format: (value) => formatDurationShort(value),
    // Whole hours past the hour mark. `formatDurationShort` would give "2h 14m"
    // here, which is three glyphs too many for the gutter and a precision no
    // axis label is read to.
    axis: (value) => (value >= 3600 ? `${Math.round(value / 3600)}h` : `${Math.round(value / 60)}m`),
  },
  reps: {
    label: 'Reps',
    // Violet, and the same borrowing: reps are this app's step count, a plain
    // tally of repetitions with no weighting, and that is the colour the app
    // being quoted counts steps in.
    tone: 5,
    pick: (totals) => totals.reps,
    format: (value) => `${Math.round(value).toLocaleString()} reps`,
    axis: (value) => compact(value),
  },
};

/**
 * A count short enough for the axis gutter.
 *
 * Four glyphs is the budget, which is what 44pt holds at the caption size once
 * the tick's own right padding is taken off. Anything under a thousand is
 * printed whole; past that the thousands are abbreviated, with one decimal
 * while that still fits ("12.5k") and none once it does not ("25k").
 *
 * Shared by volume and reps because they are the same problem: both are counts
 * that reach five figures within a few weeks of ordinary training, and both
 * were previously formatted for a readout rather than for a gutter. Duration
 * keeps its own, since hours and minutes do not abbreviate this way.
 */
function compact(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 1000) return String(rounded);

  // One decimal, kept at every magnitude rather than dropped once the whole
  // part is big enough to read on its own. That shortcut is wrong here, and
  // wrong in the one place it would show: the ticks are a nice ceiling and its
  // half, so a 25k axis has 12,500 in the middle, and rounding that to a whole
  // number of thousands labels it "13k". A midpoint that is not half of the
  // top is a worse fault than the clipping this function exists to fix.
  if (rounded < 1_000_000) return `${Math.round(rounded / 100) / 10}k`;
  return `${Math.round(rounded / 100_000) / 10}M`;
}

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
