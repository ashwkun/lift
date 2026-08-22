import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  baselineAt,
  bmiBand,
  bodyMassIndex,
  changeOverWindow,
  changePerDay,
  formatMeasurementDelta,
  formatMeasurementValue,
  fromDisplayMeasurementValue,
  isPlausibleMeasurement,
  leanMassKg,
  MEASUREMENT_GROUP_KINDS,
  MEASUREMENT_KIND_META,
  MEASUREMENT_PAIRS,
  measurementStep,
  measurementUnitLabel,
  navyBodyFatPercent,
  selectWindow,
  smoothMeasurements,
  summarizeMeasurements,
  symmetry,
  waistBand,
  waistToHeightRatio,
  type MeasurementPoint,
  type MeasurementUnitPreferences,
} from './measurements.ts';
import { MEASUREMENT_KINDS } from './types.ts';

const METRIC: MeasurementUnitPreferences = { weightUnit: 'kg', measurementUnit: 'cm' };
const IMPERIAL: MeasurementUnitPreferences = { weightUnit: 'lb', measurementUnit: 'in' };

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 20);

/** `[daysAgo, value]`, which is how every fixture below reads. */
function series(rows: [number, number][]): MeasurementPoint[] {
  return rows.map(([daysAgo, value]) => ({ at: NOW - daysAgo * DAY, value }));
}

describe('kind metadata', () => {
  it('covers every declared kind', () => {
    for (const kind of MEASUREMENT_KINDS) {
      assert.ok(MEASUREMENT_KIND_META[kind], `${kind} has no metadata`);
    }
  });

  it('groups every kind exactly once', () => {
    const grouped = Object.values(MEASUREMENT_GROUP_KINDS).flat();
    assert.equal(grouped.length, MEASUREMENT_KINDS.length);
    assert.equal(new Set(grouped).size, MEASUREMENT_KINDS.length);
  });

  it('pairs sides symmetrically', () => {
    for (const pair of MEASUREMENT_PAIRS) {
      assert.equal(MEASUREMENT_KIND_META[pair.left].counterpart, pair.right);
      assert.equal(MEASUREMENT_KIND_META[pair.right].counterpart, pair.left);
      assert.equal(MEASUREMENT_KIND_META[pair.left].side, 'left');
      assert.equal(MEASUREMENT_KIND_META[pair.right].side, 'right');
    }
  });

  it('gives every paired kind a pair entry', () => {
    const paired = MEASUREMENT_KINDS.filter((kind) => MEASUREMENT_KIND_META[kind].counterpart);
    assert.equal(paired.length, MEASUREMENT_PAIRS.length * 2);
  });
});

describe('units and formatting', () => {
  it('names the unit per scale', () => {
    assert.equal(measurementUnitLabel('bodyweight', METRIC), 'kg');
    assert.equal(measurementUnitLabel('bodyweight', IMPERIAL), 'lb');
    assert.equal(measurementUnitLabel('body_fat', IMPERIAL), '%');
    assert.equal(measurementUnitLabel('waist', IMPERIAL), 'in');
  });

  it('leaves body fat unconverted', () => {
    assert.equal(formatMeasurementValue('body_fat', 14.25, IMPERIAL), '14.3 %');
    assert.equal(fromDisplayMeasurementValue('body_fat', 14.25, IMPERIAL), 14.25);
  });

  it('round-trips a display value through storage', () => {
    const stored = fromDisplayMeasurementValue('waist', 32, IMPERIAL);
    assert.ok(Math.abs(stored - 81.28) < 1e-9);
    assert.equal(formatMeasurementValue('waist', stored, IMPERIAL), '32 in');
  });

  it('steps by what the instrument can read', () => {
    assert.equal(measurementStep('bodyweight', METRIC), 0.1);
    assert.equal(measurementStep('bodyweight', IMPERIAL), 0.2);
    assert.equal(measurementStep('chest', METRIC), 0.5);
    assert.equal(measurementStep('chest', IMPERIAL), 0.25);
  });

  it('signs a delta, and drops the sign when it rounds away', () => {
    assert.equal(formatMeasurementDelta('bodyweight', 1.2, METRIC), '+1.2 kg');
    assert.equal(formatMeasurementDelta('bodyweight', -1.2, METRIC), '−1.2 kg');
    // Under half of the last shown decimal: printing "+0 kg" would claim a
    // direction the figure cannot show.
    assert.equal(formatMeasurementDelta('bodyweight', 0.01, METRIC), '0 kg');
  });

  it('measures negligibility in display units, not storage', () => {
    // 0.03 kg rounds away in kilograms and survives as 0.066 lb, so the same
    // stored delta is unsigned in one unit and signed in the other. Judging it
    // in storage units would print "+0 kg" on the metric side.
    assert.equal(formatMeasurementDelta('bodyweight', 0.03, METRIC), '0 kg');
    assert.equal(formatMeasurementDelta('bodyweight', 0.03, IMPERIAL), '+0.1 lb');
  });

  it('rejects implausible entries', () => {
    assert.ok(isPlausibleMeasurement('waist', 82));
    assert.ok(!isPlausibleMeasurement('waist', 820));
    assert.ok(!isPlausibleMeasurement('bodyweight', 0));
    assert.ok(!isPlausibleMeasurement('body_fat', 95));
  });
});

describe('series', () => {
  it('summarizes a log', () => {
    const stats = summarizeMeasurements(series([
      [30, 84],
      [20, 83],
      [10, 82.5],
      [0, 82],
    ]))!;

    assert.equal(stats.count, 4);
    assert.equal(stats.first.value, 84);
    assert.equal(stats.latest.value, 82);
    assert.equal(stats.previous?.value, 82.5);
    assert.equal(stats.lowest.value, 82);
    assert.equal(stats.highest.value, 84);
    assert.equal(stats.change, -2);
    assert.ok(stats.changePerWeek! < 0);
  });

  it('accepts points in any order', () => {
    const shuffled = series([
      [0, 82],
      [30, 84],
      [10, 82.5],
    ]);
    const stats = summarizeMeasurements(shuffled)!;

    assert.equal(stats.first.value, 84);
    assert.equal(stats.latest.value, 82);
  });

  it('reports no rate for a single reading, or for readings at one instant', () => {
    assert.equal(summarizeMeasurements(series([[0, 82]]))!.changePerWeek, null);
    assert.equal(changePerDay(series([[0, 82], [0, 83]])), null);
    assert.equal(changePerDay([]), null);
  });

  it('fits the rate to every reading, not just the ends', () => {
    // A clean kilogram a week down, with the last reading two kilos high: a
    // heavy meal, not a reversal. First-to-last would report the series going
    // *up*; the regression keeps it going down.
    const points = series([
      [28, 84],
      [21, 83],
      [14, 82],
      [7, 81],
      [0, 82],
    ]);

    assert.ok(points[4]!.value > points[0]!.value - 4);
    assert.ok(changePerDay(points)! < 0);
  });

  it('smooths towards the trend rather than the last reading', () => {
    // The gap before the spike is exactly one half-life, which is the
    // definition of the parameter: the new reading and the running trend count
    // equally, so a 2 kg jump moves the trend by 1.
    const points = series([
      [21, 82],
      [14, 82],
      [7, 82],
      [0, 84],
    ]);
    const stats = summarizeMeasurements(points)!;

    assert.equal(stats.latest.value, 84);
    assert.ok(Math.abs(stats.trend - 83) < 1e-9, `got ${stats.trend}`);
  });

  it('gives a same-day repeat no weight of its own', () => {
    const smoothed = smoothMeasurements([
      { at: NOW, value: 80 },
      { at: NOW, value: 90 },
    ]);
    assert.equal(smoothed[1]!.value, 80);
  });

  it('weights a reading more the longer the gap before it', () => {
    const close = smoothMeasurements([
      { at: NOW - DAY, value: 80 },
      { at: NOW, value: 90 },
    ]);
    const distant = smoothMeasurements([
      { at: NOW - 60 * DAY, value: 80 },
      { at: NOW, value: 90 },
    ]);

    assert.ok(distant[1]!.value > close[1]!.value);
    assert.ok(distant[1]!.value < 90);
  });

  it('windows by time', () => {
    const points = series([
      [90, 86],
      [40, 84],
      [10, 82],
      [1, 81],
    ]);

    assert.equal(selectWindow(points, 30, NOW).length, 2);
    assert.equal(selectWindow(points, 365, NOW).length, 4);
    assert.equal(selectWindow(points, 0, NOW).length, 0);
  });

  it('measures a window change from the reading that was standing when it opened', () => {
    // One reading inside 30 days. Comparing the window's contents to themselves
    // would report no change; the honest baseline is the entry before it.
    const points = series([
      [45, 86],
      [2, 82],
    ]);

    const change = changeOverWindow(points, 30, NOW)!;
    assert.equal(change.from.value, 86);
    assert.equal(change.delta, -4);
    assert.equal(change.spanDays, 43);
  });

  it('falls back to the oldest reading when the log is younger than the window', () => {
    const change = changeOverWindow(series([[10, 84], [0, 82]]), 90, NOW)!;
    assert.equal(change.from.value, 84);
    assert.equal(change.delta, -2);
  });

  it('has no change to report from a lone reading', () => {
    assert.equal(changeOverWindow(series([[0, 82]]), 30, NOW), null);
  });

  it('finds the reading standing at an instant', () => {
    const points = series([
      [30, 84],
      [10, 82],
    ]);

    assert.equal(baselineAt(points, NOW)!.value, 82);
    assert.equal(baselineAt(points, NOW - 20 * DAY)!.value, 84);
    assert.equal(baselineAt(points, NOW - 40 * DAY), null);
  });
});

describe('body composition', () => {
  it('computes BMI and bands it', () => {
    const bmi = bodyMassIndex(82, 180)!;
    assert.ok(Math.abs(bmi - 25.31) < 0.01);
    assert.equal(bmiBand(bmi), 'overweight');
    assert.equal(bmiBand(22), 'healthy');
    assert.equal(bmiBand(17), 'underweight');
    assert.equal(bmiBand(31), 'obese');
  });

  it('needs a height for BMI', () => {
    assert.equal(bodyMassIndex(82, null), null);
    assert.equal(bodyMassIndex(82, 0), null);
  });

  it('estimates body fat from circumferences', () => {
    // A 180 cm man, 85 cm waist, 38 cm neck. The Navy regression puts this at
    // roughly 18%.
    const male = navyBodyFatPercent({
      sex: 'male',
      heightCm: 180,
      neckCm: 38,
      waistCm: 85,
    })!;
    assert.ok(male > 16 && male < 20, `got ${male}`);

    const female = navyBodyFatPercent({
      sex: 'female',
      heightCm: 165,
      neckCm: 32,
      waistCm: 72,
      hipCm: 96,
    })!;
    assert.ok(female > 24 && female < 30, `got ${female}`);
  });

  it('falls to null rather than guessing', () => {
    // The female formula needs a hip measurement the male one ignores.
    assert.equal(
      navyBodyFatPercent({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 72 }),
      null,
    );
    // A waist under the neck is a mis-entry, and the logarithm is undefined.
    assert.equal(
      navyBodyFatPercent({ sex: 'male', heightCm: 180, neckCm: 40, waistCm: 38 }),
      null,
    );
    assert.equal(navyBodyFatPercent({ sex: 'male', heightCm: 0, neckCm: 38, waistCm: 85 }), null);
  });

  it('clamps an out-of-range regression into the plausible band', () => {
    // A very lean body with a thick neck drives the male formula negative.
    const percent = navyBodyFatPercent({
      sex: 'male',
      heightCm: 190,
      neckCm: 44,
      waistCm: 45,
    });
    assert.ok(percent !== null && percent >= MEASUREMENT_KIND_META.body_fat.min);
  });

  it('splits weight into lean and fat', () => {
    assert.ok(Math.abs(leanMassKg(80, 20) - 64) < 1e-9);
  });

  it('bands waist against height', () => {
    const ratio = waistToHeightRatio(85, 180)!;
    assert.ok(Math.abs(ratio - 0.472) < 0.001);
    assert.equal(waistBand(ratio), 'healthy');
    assert.equal(waistBand(0.55), 'raised');
    assert.equal(waistBand(0.62), 'high');
    assert.equal(waistToHeightRatio(85, null), null);
  });

  it('compares sides', () => {
    const result = symmetry(38, 39.5)!;
    assert.equal(result.larger, 'right');
    assert.ok(Math.abs(result.difference - 1.5) < 1e-9);
    assert.ok(Math.abs(result.percent - 3.797) < 0.001);

    assert.equal(symmetry(38, 38)!.larger, 'even');
    assert.equal(symmetry(38, 0), null);
  });
});
