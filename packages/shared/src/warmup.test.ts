import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_BAR_KG,
  DEFAULT_BAR_LB_IN_KG,
  DEFAULT_PLATES_LB,
  calculatePlates,
  type PlateSpec,
} from './plates.ts';
import { kgToLb, lbToKg } from './units.ts';
import { buildWarmupRamp, WARMUP_STYLES, type WarmupInput } from './warmup.ts';

/** A 100 kg barbell squat on a 20 kg bar in a fully stocked kg gym. */
function squat(overrides: Partial<WarmupInput> = {}): WarmupInput {
  return {
    workingKg: 100,
    trackingType: 'weight_reps',
    equipment: 'barbell',
    barKg: DEFAULT_BAR_KG,
    ...overrides,
  };
}

/** The ramp as it reads on screen: weight and reps per rung. */
function rungs(input: WarmupInput): [number, number][] {
  return buildWarmupRamp(input).sets.map((set) => [set.weightKg, set.reps]);
}

// ---------------------------------------------------------------------------
// The ramp itself
// ---------------------------------------------------------------------------

test('the standard ramp is 40/60/80 with the reps coming down', () => {
  assert.deepEqual(rungs(squat()), [
    [40, 8],
    [60, 5],
    [80, 3],
  ]);
});

test('style picks the number of rungs, and standard is the default', () => {
  assert.equal(buildWarmupRamp(squat({ style: 'quick' })).sets.length, 2);
  assert.equal(buildWarmupRamp(squat({ style: 'standard' })).sets.length, 3);
  assert.equal(buildWarmupRamp(squat({ style: 'thorough' })).sets.length, 5);

  const fallback = buildWarmupRamp(squat());
  assert.equal(fallback.style, 'standard');
  assert.equal(fallback.sets.length, 3);
});

test('every style ramps up in weight and down in reps', () => {
  for (const style of WARMUP_STYLES) {
    // 187.5 kg is deliberately awkward: it is loadable, but two thirds of the
    // rungs under it are not, so this also exercises the snapping.
    const { sets } = buildWarmupRamp(squat({ workingKg: 187.5, style }));

    assert.ok(sets.length >= 2, `${style} produced ${sets.length} rungs`);

    for (let i = 1; i < sets.length; i += 1) {
      assert.ok(sets[i]!.weightKg > sets[i - 1]!.weightKg, `${style} rung ${i} did not go up`);
      assert.ok(sets[i]!.reps <= sets[i - 1]!.reps, `${style} rung ${i} did not taper`);
    }
  }
});

test('no rung reaches the working weight', () => {
  for (const style of WARMUP_STYLES) {
    for (const workingKg of [22.5, 40, 62.5, 100, 142.5, 260]) {
      for (const set of buildWarmupRamp(squat({ workingKg, style })).sets) {
        assert.ok(set.weightKg < workingKg, `${style} at ${workingKg} emitted ${set.weightKg}`);
      }
    }
  }
});

test('fraction reports what the rung asked for, not what it got', () => {
  // 102.5 kg: 40% is 41, which no rack in this app can make. The rung lands on
  // 40 and still says it was aiming at 0.4, because a caller recomputing the
  // achieved share would print a percentage nobody prescribed.
  const [first] = buildWarmupRamp(squat({ workingKg: 102.5 })).sets;

  assert.equal(first?.weightKg, 40);
  assert.equal(first?.fraction, 0.4);
});

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

test('every barbell rung is a weight the plates can actually make', () => {
  for (const workingKg of [45, 62.5, 100, 102.5, 137.5, 180, 227.5]) {
    for (const set of buildWarmupRamp(squat({ workingKg, style: 'thorough' })).sets) {
      const loading = calculatePlates(set.weightKg, DEFAULT_BAR_KG);
      assert.ok(
        loading.exact || loading.belowBar,
        `${set.weightKg} kg is not loadable under a ${workingKg} kg working set`,
      );
    }
  }
});

test('a rack with nothing light on it collapses rungs instead of repeating one', () => {
  // 20s only: 40% of 100 kg cannot be made at all, 60% can, and 80% snaps back
  // down onto 60 because the rounding-up candidate is the working weight itself.
  // Three targets, two honest rungs, and the empty bar is the light one.
  const sparse: PlateSpec[] = [{ weightKg: 20, count: 8 }];

  assert.deepEqual(rungs(squat({ inventory: sparse })), [
    [20, 8],
    [60, 5],
  ]);
});

test('a rung rounds up when that is closer, and never past the working set', () => {
  // 25s only, on a 20 kg bar: the whole ladder is 20, 70, 120. A 145 kg working
  // set asks for 58 / 87 / 116. Greedy plate maths would answer 20 / 70 / 70 to
  // those, since it only ever rounds down; rounding to whichever loadable
  // weight is *nearer* gets 70 for the first and 120 for the last, and the
  // middle one collapses onto the first and drops out.
  const heavy: PlateSpec[] = [{ weightKg: 25, count: 8 }];

  assert.deepEqual(rungs(squat({ workingKg: 145, inventory: heavy })), [
    [70, 8],
    [120, 3],
  ]);

  // And the ceiling, on the same rack, two kilos either side of it. At 121 kg
  // the top rung is allowed to round up to 120; at 119 that same 120 is no
  // longer lighter than the set it exists to prepare for, so the rung falls
  // back to the 70 it can reach and the ramp is one rung shorter.
  const weights = (workingKg: number) =>
    rungs(squat({ workingKg, inventory: heavy, style: 'thorough' })).map(([kg]) => kg);

  assert.deepEqual(weights(121), [20, 70, 120]);
  assert.deepEqual(weights(119), [20, 70]);
});

test('the lb rack ramps in its own plates rather than in translated kg', () => {
  const { sets } = buildWarmupRamp(
    squat({
      workingKg: lbToKg(225),
      barKg: DEFAULT_BAR_LB_IN_KG,
      inventory: DEFAULT_PLATES_LB,
      style: 'thorough',
    }),
  );

  // Read back in the unit it was built for: 225 lb warms up 70 / 100 / 135 /
  // 170 / 205, every one of them a 45 lb bar plus a pair of plates off an
  // American rack. Storage is kilograms and the catalogue rounds 45 lb to
  // 20.4117 of them, so none of these is a round number in kg and the whole
  // ramp is float noise until it is converted back.
  assert.deepEqual(
    sets.map((set) => Math.round(kgToLb(set.weightKg) * 10) / 10),
    [70, 100, 135, 170, 205],
  );
});

// ---------------------------------------------------------------------------
// Equipment that is not a barbell
// ---------------------------------------------------------------------------

test('dumbbells snap to the rack ladder and ignore the bar entirely', () => {
  assert.deepEqual(rungs(squat({ workingKg: 30, equipment: 'dumbbell' })), [
    [12, 8],
    [18, 5],
    [24, 3],
  ]);

  // A 20 kg bar under a 30 kg dumbbell would have swallowed the first two rungs.
  assert.equal(buildWarmupRamp(squat({ workingKg: 30, equipment: 'dumbbell' })).skipped, null);
});

test('the Smith machine steps rather than counting plates', () => {
  // One pair of 25s on the shelf: a barbell can only reach 20 and 70 out of the
  // 40 / 60 / 80 it wanted. The Smith makes no claim about what is on the bar,
  // so it snaps to its 2.5 kg step and gets all three.
  const heavy: PlateSpec[] = [{ weightKg: 25, count: 2 }];

  assert.deepEqual(rungs(squat({ inventory: heavy })), [
    [20, 8],
    [70, 5],
  ]);
  assert.deepEqual(rungs(squat({ inventory: heavy, equipment: 'smith_machine' })), [
    [40, 8],
    [60, 5],
    [80, 3],
  ]);
});

test('machines round to the pin, and the lightest pin is the floor', () => {
  assert.deepEqual(rungs(squat({ workingKg: 100, equipment: 'machine' })), [
    [40, 8],
    [60, 5],
    [80, 3],
  ]);

  // A 7.5 kg stack: 40% and 60% both round to 5, and 80% would round onto the
  // working weight itself. One rung survives, and it is the only honest one.
  assert.deepEqual(rungs(squat({ workingKg: 7.5, equipment: 'machine' })), [[5, 8]]);
});

test('equipment with no load step gets no ramp', () => {
  for (const equipment of ['resistance_band', 'suspension', 'cardio_machine'] as const) {
    assert.equal(buildWarmupRamp(squat({ equipment })).skipped, 'unloadable');
  }
});

// ---------------------------------------------------------------------------
// The rep taper
// ---------------------------------------------------------------------------

test('working reps cap the taper and never raise it', () => {
  assert.deepEqual(rungs(squat({ workingReps: 3 })), [
    [40, 3],
    [60, 3],
    [80, 3],
  ]);

  // Twenty-rep squats do not get a twenty-rep warm-up.
  assert.deepEqual(rungs(squat({ workingReps: 20 })), rungs(squat()));

  // Unknown reps are the planning case, and change nothing.
  assert.deepEqual(rungs(squat({ workingReps: null })), rungs(squat()));
});

test('a working set of no reps still gets a rung of one', () => {
  for (const set of buildWarmupRamp(squat({ workingReps: 0 })).sets) {
    assert.equal(set.reps, 1);
  }
});

// ---------------------------------------------------------------------------
// The answers that are "no"
// ---------------------------------------------------------------------------

test('tracking types that are not weight times reps have no ramp to build', () => {
  for (const trackingType of [
    'bodyweight_reps',
    'duration',
    'distance_duration',
    'weight_distance',
    'reps_only',
  ] as const) {
    const ramp = buildWarmupRamp(squat({ trackingType }));
    assert.equal(ramp.skipped, 'tracking_type');
    assert.deepEqual(ramp.sets, []);
  }
});

test('weighted and assisted bodyweight lifts are refused, not approximated', () => {
  for (const trackingType of ['weighted_bodyweight', 'assisted_bodyweight'] as const) {
    // Both render a weight field and both ask for reps, so only the
    // `USES_BODYWEIGHT` check stands between a 20 kg belt and a ramp that walks
    // the wrong way.
    assert.equal(buildWarmupRamp(squat({ trackingType })).skipped, 'bodyweight');
  }
});

test('no usable working weight, no ramp', () => {
  for (const workingKg of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(buildWarmupRamp(squat({ workingKg })).skipped, 'no_working_weight');
  }
});

test('a working set at or under the empty bar has nothing to warm up with', () => {
  for (const workingKg of [10, 15, DEFAULT_BAR_KG]) {
    const ramp = buildWarmupRamp(squat({ workingKg }));
    assert.equal(ramp.skipped, 'unloadable', `${workingKg} kg produced a ramp`);
    assert.deepEqual(ramp.sets, []);
  }
});

test('a lift barely over the bar warms up with the bar, once', () => {
  // Every rung of a 25 kg barbell curl is under the bar, so every rung is the
  // bar, and the duplicate filter leaves one. This is the right answer rather
  // than a degenerate one: an empty-bar set is exactly what anybody does before
  // a lift this light, and it is what `calculatePlates` reports as `belowBar`.
  assert.deepEqual(rungs(squat({ workingKg: 25 })), [[20, 8]]);
});

test('the style survives a skip, so a caller can still say which one it asked for', () => {
  const ramp = buildWarmupRamp(squat({ trackingType: 'duration', style: 'thorough' }));

  assert.equal(ramp.style, 'thorough');
  assert.equal(ramp.skipped, 'tracking_type');
});

test('sets is empty exactly when skipped is set', () => {
  const inputs: WarmupInput[] = [
    squat(),
    squat({ workingKg: 20 }),
    squat({ trackingType: 'duration' }),
    squat({ equipment: 'resistance_band' }),
    squat({ workingKg: 30, equipment: 'dumbbell' }),
    squat({ workingKg: Number.NaN }),
  ];

  for (const input of inputs) {
    const ramp = buildWarmupRamp(input);
    assert.equal(ramp.sets.length === 0, ramp.skipped !== null);
  }
});

test('the inventory handed in is never reordered or otherwise touched', () => {
  const inventory: PlateSpec[] = [
    { weightKg: 5, count: 4 },
    { weightKg: 20, count: 8 },
    { weightKg: 10, count: 4 },
  ];
  const before = JSON.stringify(inventory);

  buildWarmupRamp(squat({ inventory, style: 'thorough' }));

  assert.equal(JSON.stringify(inventory), before);
});
