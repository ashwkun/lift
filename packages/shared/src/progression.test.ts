import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultIncrementKg,
  inferRepRange,
  suggestProgression,
  type ExerciseSession,
  type PerformedSet,
  type ProgressionConfig,
  type Suggestion,
} from './progression.ts';
import { EQUIPMENT } from './types.ts';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

/** One completed working set: the only shape most of these tests need. */
function set(
  weightKg: number | null,
  reps: number | null,
  over: Partial<PerformedSet> = {},
): PerformedSet {
  return { weightKg, reps, setType: 'normal', isCompleted: true, ...over };
}

/** `count` identical working sets, the shape almost every session has. */
function straight(weightKg: number | null, reps: number, count = 3): PerformedSet[] {
  return Array.from({ length: count }, () => set(weightKg, reps));
}

/** `count` identical working sets, each rated at the same effort. */
function rated(
  weightKg: number | null,
  reps: number,
  rpe: number,
  count = 3,
): PerformedSet[] {
  return Array.from({ length: count }, () => set(weightKg, reps, { rpe }));
}

/** Sessions newest-first, a day apart, which is the order the engine documents. */
function sessions(...entries: PerformedSet[][]): ExerciseSession[] {
  return entries.map((sets, index) => ({ startedAt: NOW - index * DAY, sets }));
}

function config(over: Partial<ProgressionConfig> = {}): ProgressionConfig {
  return { trackingType: 'weight_reps', minReps: 8, maxReps: 12, incrementKg: 2.5, ...over };
}

/** Asserts a suggestion exists and hands it back narrowed. */
function suggest(
  history: ExerciseSession[],
  over: Partial<ProgressionConfig> = {},
): Suggestion {
  const suggestion = suggestProgression(history, config(over));
  assert.ok(suggestion, 'expected a suggestion');
  return suggestion;
}

// ---------------------------------------------------------------------------
// The per-set branches
// ---------------------------------------------------------------------------

test('clearing the top of the range asks for weight, at the bottom of it', () => {
  const suggestion = suggest(sessions(straight(100, 12)));

  assert.equal(suggestion.kind, 'add_weight');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 102.5, reps: 8 },
    { workingIndex: 2, weightKg: 102.5, reps: 8 },
    { workingIndex: 3, weightKg: 102.5, reps: 8 },
  ]);
  assert.equal(suggestion.reason, 'Cleared 12 reps on every set');
});

test('inside the range asks for one more rep at the same weight', () => {
  const suggestion = suggest(sessions(straight(100, 10)));

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 100, reps: 11 },
    { workingIndex: 2, weightKg: 100, reps: 11 },
    { workingIndex: 3, weightKg: 100, reps: 11 },
  ]);
  assert.equal(suggestion.reason, 'Two reps off the top of the range');
});

test('under the range holds, rather than asking for more of a weight already too heavy', () => {
  const suggestion = suggest(sessions(straight(100, 6)));

  assert.equal(suggestion.kind, 'hold');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 100, reps: 6 },
    { workingIndex: 2, weightKg: 100, reps: 6 },
    { workingIndex: 3, weightKg: 100, reps: 6 },
  ]);
  assert.equal(suggestion.reason, 'Short of 8 reps: repeat this weight');
});

test('the weight only moves when every set cleared the top', () => {
  const suggestion = suggest(sessions([set(100, 12), set(100, 12), set(100, 10)]));

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.reps),
    [12, 12, 11],
    'the sets that cleared repeat; only the short one gains a rep',
  );
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [100, 100, 100],
  );
  assert.equal(suggestion.reason, 'Two of three sets cleared 12');
});

test('one set well under the band pins the whole exercise, however good the first was', () => {
  const suggestion = suggest(sessions([set(100, 12), set(100, 4)]));

  assert.equal(suggestion.kind, 'hold');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.reps),
    [12, 4],
  );
  assert.equal(suggestion.reason, 'One of two sets fell short of 8');
});

test('a 5×5 band with no room inside it steps the weight straight away', () => {
  const suggestion = suggest(sessions(straight(100, 5, 5)), { minReps: 5, maxReps: 5 });

  assert.equal(suggestion.kind, 'add_weight');
  assert.equal(suggestion.sets.length, 5);
  assert.deepEqual(suggestion.sets[0], { workingIndex: 1, weightKg: 102.5, reps: 5 });
});

// ---------------------------------------------------------------------------
// Assisted work runs backwards
// ---------------------------------------------------------------------------

test('assistance comes off, not on, when the range is cleared', () => {
  const suggestion = suggest(sessions(straight(40, 12)), {
    trackingType: 'assisted_bodyweight',
  });

  assert.equal(suggestion.kind, 'add_weight');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [37.5, 37.5, 37.5],
    'less help is harder work. Adding assistance would make the exercise easier',
  );
  assert.equal(suggestion.reason, 'Cleared 12 reps on every set: less help next time');
});

test('assistance never goes negative', () => {
  const suggestion = suggest(sessions(straight(2, 12)), {
    trackingType: 'assisted_bodyweight',
  });

  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [0, 0, 0],
  );
});

test('assistance coming down session by session is progress, not a stall', () => {
  const suggestion = suggest(
    sessions(straight(40, 10), straight(42.5, 10), straight(45, 10)),
    { trackingType: 'assisted_bodyweight' },
  );

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.reps),
    [11, 11, 11],
  );
});

test('needing more help three sessions running backs off by adding help', () => {
  const suggestion = suggest(
    sessions(straight(45, 6), straight(42.5, 6), straight(40, 6)),
    { trackingType: 'assisted_bodyweight' },
  );

  assert.equal(suggestion.kind, 'back_off');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [50, 50, 50],
  );
  assert.equal(suggestion.reason, 'Short of 8 reps for three sessions. Add 10% more help');
});

// ---------------------------------------------------------------------------
// Stalling
//
// Every fixture here comes in *under* the band on purpose. A stall is not a
// flat history. It is a history with no weight left to add and no rep left to
// add, which is the only state a lifter cannot progress out of on their own.
// ---------------------------------------------------------------------------

test('three sessions short of the range take load off', () => {
  const suggestion = suggest(sessions(straight(100, 6), straight(100, 6), straight(100, 6)));

  assert.equal(suggestion.kind, 'back_off');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 90, reps: 8 },
    { workingIndex: 2, weightKg: 90, reps: 8 },
    { workingIndex: 3, weightKg: 90, reps: 8 },
  ]);
  assert.equal(suggestion.reason, 'Short of 8 reps for three sessions. Take 10% off');
});

test('three flat sessions with room in the band ask for a rep, not a deload', () => {
  // The state every lifter is in the first time this feature speaks to them:
  // the same weight repeated, because nothing had ever asked them to push it.
  // Reading that as a stall took 10% off someone who had never been given a
  // target to miss.
  const suggestion = suggest(sessions(straight(100, 10), straight(100, 10), straight(100, 10)));

  assert.equal(suggestion.kind, 'add_reps', 'room left in the band is not being stuck');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.reps),
    [11, 11, 11],
  );
});

test('a mixed session names how many sets fell short', () => {
  const short = [set(100, 12), set(100, 6), set(100, 6)];
  const suggestion = suggest(sessions(short, short, short));

  assert.equal(suggestion.kind, 'back_off');
  assert.equal(suggestion.reason, 'Two of three sets short for three sessions. Take 10% off');
});

test('two sessions short of the range is a bad week, not a stall', () => {
  const suggestion = suggest(sessions(straight(100, 6), straight(100, 6)));

  assert.equal(suggestion.kind, 'hold', 'two sessions is not enough history to deload on');
});

test('a rep gained under the range still breaks the stall', () => {
  const suggestion = suggest(sessions(straight(100, 7), straight(100, 6), straight(100, 6)));

  assert.equal(suggestion.kind, 'hold', 'they are climbing back already. Leave the weight alone');
});

test('a stall at the top of the range still gets the weight, not a back-off', () => {
  const suggestion = suggest(
    sessions(straight(100, 12), straight(100, 12), straight(100, 12)),
  );

  assert.equal(suggestion.kind, 'add_weight', 'they were waiting on this, not stuck under it');
});

test('a shorter stall window can be asked for', () => {
  const suggestion = suggest(sessions(straight(100, 6), straight(100, 6)), {
    stallSessions: 2,
  });

  assert.equal(suggestion.kind, 'back_off');
  assert.equal(suggestion.reason, 'Short of 8 reps for two sessions. Take 10% off');
});

test('the back-off fraction is configurable and lands on a loadable weight', () => {
  const suggestion = suggest(sessions(straight(100, 6), straight(100, 6), straight(100, 6)), {
    backOffFraction: 0.8,
  });

  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [80, 80, 80],
  );
  assert.equal(suggestion.reason, 'Short of 8 reps for three sessions. Take 20% off');
});

test('a back-off the rounding would swallow steps by one increment instead', () => {
  // 10% off a 10 kg stack rounds straight back onto 10 kg with a 5 kg pin.
  const suggestion = suggest(sessions(straight(10, 6), straight(10, 6), straight(10, 6)), {
    incrementKg: 5,
  });

  assert.equal(suggestion.kind, 'back_off');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [5, 5, 5],
    'a back-off that suggests the weight they just failed at is not a back-off',
  );
});

test('sessions handed over oldest-first are read in the right order', () => {
  const oldestFirst = sessions(straight(100, 6), straight(100, 6), straight(100, 6))
    .reverse()
    .map((session, index) => ({ ...session, startedAt: NOW - (2 - index) * DAY }));

  // Same three sessions; the timestamps decide, not the array order.
  assert.equal(suggest(oldestFirst).kind, 'back_off');
});

// ---------------------------------------------------------------------------
// What counts as beating the session before
// ---------------------------------------------------------------------------

test('a descending run that moved on its back-off sets is not a stall', () => {
  // Only the top set held still. Comparing sessions by their heaviest set alone
  // saw three identical 100s and called it a stall, while sets two and three
  // went up 2.5 and 5 kg: a lifter improving the whole time, told to deload.
  const suggestion = suggest(
    sessions(
      [set(100, 6), set(97.5, 6), set(95, 6)],
      [set(100, 6), set(96, 6), set(92.5, 6)],
      [set(100, 6), set(95, 6), set(90, 6)],
    ),
  );

  assert.equal(suggestion.kind, 'hold', 'two of three sets improved. Nothing is stuck');
});

test('adding a working set counts as beating the session before', () => {
  const suggestion = suggest(
    sessions(straight(100, 6, 4), straight(100, 6, 3), straight(100, 6, 3)),
  );

  assert.equal(suggestion.kind, 'hold', 'a fourth set is more work, however it was logged');
});

test('a set going backwards does not erase another going forwards', () => {
  const suggestion = suggest(
    sessions(
      [set(105, 6), set(90, 6)],
      [set(100, 6), set(95, 6)],
      [set(100, 6), set(95, 6)],
    ),
  );

  assert.equal(suggestion.kind, 'hold', 'the top set went up; that is not a stall');
});

// ---------------------------------------------------------------------------
// Loadable numbers
// ---------------------------------------------------------------------------

test('a suggestion is always a weight the gym can actually load', () => {
  const stepped = suggest(sessions(straight(82.4, 12)));
  assert.deepEqual(
    stepped.sets.map((entry) => entry.weightKg),
    [85, 85, 85],
  );

  const backedOff = suggest(
    sessions(straight(102.5, 6), straight(102.5, 6), straight(102.5, 6)),
  );
  assert.deepEqual(
    backedOff.sets.map((entry) => entry.weightKg),
    [92.5, 92.5, 92.5],
  );

  for (const entry of [...stepped.sets, ...backedOff.sets]) {
    const multiples = (entry.weightKg ?? 0) / 2.5;
    assert.ok(
      Math.abs(multiples - Math.round(multiples)) < 1e-9,
      `${entry.weightKg} is not a multiple of 2.5`,
    );
  }
});

test('a dumbbell steps by its own increment, not the barbell one', () => {
  const suggestion = suggest(sessions(straight(22, 12)), {
    incrementKg: defaultIncrementKg('dumbbell'),
  });

  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [24, 24, 24],
  );
});

// ---------------------------------------------------------------------------
// Nothing worth saying
// ---------------------------------------------------------------------------

test('no history says nothing at all', () => {
  assert.equal(suggestProgression([], config()), null);
  assert.equal(suggestProgression(sessions([]), config()), null);
});

test('warm-ups and unchecked sets are not history', () => {
  const warmupsOnly = sessions([
    set(40, 15, { setType: 'warmup' }),
    set(60, 10, { setType: 'warmup' }),
  ]);
  assert.equal(suggestProgression(warmupsOnly, config()), null);

  const nothingChecked = sessions(straight(100, 12).map((s) => ({ ...s, isCompleted: false })));
  assert.equal(suggestProgression(nothingChecked, config()), null);

  const noReps = sessions([set(100, null), set(100, 0)]);
  assert.equal(suggestProgression(noReps, config()), null);
});

test('a warm-up ramp does not take a working-set number or a vote', () => {
  const suggestion = suggest(
    sessions([
      set(40, 15, { setType: 'warmup' }),
      set(80, 8, { setType: 'warmup' }),
      set(100, 12),
      set(100, 12),
    ]),
  );

  assert.equal(suggestion.kind, 'add_weight', 'the warm-up sets of 15 and 8 say nothing');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.workingIndex),
    [1, 2],
  );
});

test('the engine keeps its opinions to itself on runs, walks and planks', () => {
  const history = sessions(straight(100, 12));

  for (const trackingType of ['duration', 'distance_duration', 'weight_distance'] as const) {
    assert.equal(
      suggestProgression(history, config({ trackingType })),
      null,
      `${trackingType} is not a rep and a weight`,
    );
  }
});

// ---------------------------------------------------------------------------
// Nothing to load
// ---------------------------------------------------------------------------

test('bodyweight work climbs past the top of the range instead of adding weight', () => {
  const suggestion = suggest(sessions(straight(null, 20)), {
    trackingType: 'bodyweight_reps',
    incrementKg: defaultIncrementKg('bodyweight'),
  });

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: null, reps: 21 },
    { workingIndex: 2, weightKg: null, reps: 21 },
    { workingIndex: 3, weightKg: null, reps: 21 },
  ]);
  assert.equal(suggestion.reason, 'No load to add: climb past 12 reps instead');
});

test('bodyweight work is never told to take 10% off nothing', () => {
  const suggestion = suggest(
    sessions(straight(null, 10), straight(null, 10), straight(null, 10)),
    { trackingType: 'bodyweight_reps', incrementKg: 0 },
  );

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [null, null, null],
  );
});

test('an empty weight box on weighted work means no belt, and steps from zero', () => {
  const suggestion = suggest(sessions(straight(null, 12)), {
    trackingType: 'weighted_bodyweight',
  });

  assert.equal(suggestion.kind, 'add_weight');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [2.5, 2.5, 2.5],
  );
});

test('a barbell set logged without a weight never produces a number out of thin air', () => {
  const suggestion = suggest(sessions([set(null, 12), set(100, 12)]));

  assert.equal(suggestion.kind, 'add_reps', 'there is no load here to add 2.5 kg to');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: null, reps: 13 },
    { workingIndex: 2, weightKg: 100, reps: 13 },
  ]);
});

test('nulls and junk never reach the screen as NaN', () => {
  const suggestion = suggest(
    sessions([set(null, null), set(Number.NaN, 12), set(100, Number.NaN), set(100, 10)]),
  );

  for (const entry of suggestion.sets) {
    assert.ok(
      entry.weightKg === null || Number.isFinite(entry.weightKg),
      `weight ${entry.weightKg} would render as "NaN kg"`,
    );
    assert.ok(Number.isFinite(entry.reps), `reps ${entry.reps} is not a number`);
  }
});

// ---------------------------------------------------------------------------
// The line under the heading
// ---------------------------------------------------------------------------

test('every reason is one sentence-cased line with no full stop', () => {
  const suggestions = [
    suggest(sessions(straight(100, 12))),
    suggest(sessions(straight(100, 10))),
    suggest(sessions(straight(100, 6))),
    suggest(sessions(straight(100, 10), straight(100, 10), straight(100, 10))),
    suggest(sessions([set(100, 12), set(100, 9)])),
  ];

  for (const { reason } of suggestions) {
    assert.ok(reason.length > 0, 'a suggestion without a reason is an unexplained number');
    assert.ok(!reason.includes('\n'), `"${reason}" is more than one line`);
    assert.ok(!reason.endsWith('.'), `"${reason}" ends in a full stop`);
    assert.match(reason, /^[A-Z0-9]/, `"${reason}" is not sentence case`);
    assert.ok(reason.length < 60, `"${reason}" is too long for a caption`);
  }
});

// ---------------------------------------------------------------------------
// Increments
// ---------------------------------------------------------------------------

test('every piece of equipment has a step, and none of them is nonsense', () => {
  for (const equipment of EQUIPMENT) {
    const increment = defaultIncrementKg(equipment);
    assert.ok(Number.isFinite(increment), `${equipment} has no finite increment`);
    assert.ok(increment >= 0, `${equipment} steps backwards`);
  }
});

test('the increments match the plates and pins that exist', () => {
  assert.equal(defaultIncrementKg('barbell'), 2.5); // a pair of 1.25s
  assert.equal(defaultIncrementKg('smith_machine'), 2.5);
  assert.equal(defaultIncrementKg('dumbbell'), 2);
  assert.equal(defaultIncrementKg('machine'), 5); // one pin down the stack
  assert.equal(defaultIncrementKg('kettlebell'), 4);
});

test('equipment with no load to step says so with a zero', () => {
  assert.equal(defaultIncrementKg('bodyweight'), 0);
  assert.equal(defaultIncrementKg('resistance_band'), 0);
  assert.equal(defaultIncrementKg('suspension'), 0);
  assert.equal(defaultIncrementKg('cardio_machine'), 0);
});

// ---------------------------------------------------------------------------
// Inferring the band
// ---------------------------------------------------------------------------

test('a lifter who only ever does fives is not walked up to twelve', () => {
  assert.deepEqual(inferRepRange(sessions(straight(100, 5, 5), straight(100, 5, 5))), {
    minReps: 5,
    maxReps: 7,
  });
});

test('a band is read off both ends of what was actually done', () => {
  assert.deepEqual(inferRepRange(sessions([set(100, 12), set(100, 10), set(100, 8)])), {
    minReps: 8,
    maxReps: 12,
  });
});

test('one absurd set does not stretch the band across the whole rep chart', () => {
  assert.deepEqual(inferRepRange(sessions([set(100, 30), set(100, 5), set(100, 5)])), {
    minReps: 5,
    maxReps: 13,
  });
});

test('no usable history falls back to eight to twelve', () => {
  assert.deepEqual(inferRepRange([]), { minReps: 8, maxReps: 12 });
  assert.deepEqual(inferRepRange(sessions([])), { minReps: 8, maxReps: 12 });
  assert.deepEqual(inferRepRange(sessions([set(40, 15, { setType: 'warmup' })])), {
    minReps: 8,
    maxReps: 12,
  });
  assert.deepEqual(
    inferRepRange(sessions([set(100, 10, { isCompleted: false })])),
    { minReps: 8, maxReps: 12 },
  );
});

// ---------------------------------------------------------------------------
// Autoregulating on effort
//
// Every fixture here would be an `add_reps` without its RPE column, which is
// the only place the two rules are allowed to reach. The pair of them is
// deliberately narrow: they fire at the ends of the scale, they need every set
// in the session to agree, and they move the suggestion one step along the axis
// it was already on.
// ---------------------------------------------------------------------------

test('an unrated history is answered exactly as it was before RPE existed', () => {
  const silent = suggest(sessions(straight(100, 10)));
  const explicit = suggest(sessions(straight(100, 10).map((s) => ({ ...s, rpe: null }))));

  assert.deepEqual(explicit, silent, 'an absent rpe and a null one are the same fact');
  assert.equal(silent.kind, 'add_reps');
  assert.equal(silent.reason, 'Two reps off the top of the range');
});

test('reps to spare on every set take the load now instead of walking up the band', () => {
  // Four reps in reserve at every set, six weeks of "add one rep" away from a
  // step this lifter could take today.
  const suggestion = suggest(sessions(rated(100, 10, 6)));

  assert.equal(suggestion.kind, 'add_weight');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 102.5, reps: 10 },
    { workingIndex: 2, weightKg: 102.5, reps: 10 },
    { workingIndex: 3, weightKg: 102.5, reps: 10 },
  ]);
  assert.equal(suggestion.reason, 'Every set at RPE 6 or easier: add load now');
});

test('the early load keeps the reps rather than resetting to the bottom of the band', () => {
  const early = suggest(sessions(rated(100, 11, 6)));
  const cleared = suggest(sessions(straight(100, 12)));

  assert.deepEqual(
    early.sets.map((entry) => entry.reps),
    [11, 11, 11],
    'the increment is paid for out of the reserve, not out of three reps',
  );
  assert.deepEqual(
    cleared.sets.map((entry) => entry.reps),
    [8, 8, 8],
    'a cleared range still pays for the step with the reps',
  );
});

test('one hard set vetoes the early load', () => {
  const suggestion = suggest(
    sessions([set(100, 10, { rpe: 6 }), set(100, 10, { rpe: 6 }), set(100, 10, { rpe: 8 })]),
  );

  assert.equal(suggestion.kind, 'add_reps', 'the last set was at target. There is no spare load');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [100, 100, 100],
  );
});

test('one unrated set leaves the whole session unread', () => {
  const suggestion = suggest(
    sessions([set(100, 10, { rpe: 6 }), set(100, 10, { rpe: 6 }), set(100, 10)]),
  );

  assert.equal(
    suggestion.kind,
    'add_reps',
    'a session rated once and then forgotten about is not a session that was easy',
  );
});

test('nothing left in reserve is not asked for another rep', () => {
  const suggestion = suggest(sessions(rated(100, 10, 10)));

  assert.equal(suggestion.kind, 'hold');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 100, reps: 10 },
    { workingIndex: 2, weightKg: 100, reps: 10 },
    { workingIndex: 3, weightKg: 100, reps: 10 },
  ]);
  assert.equal(suggestion.reason, 'Every set at RPE 10 or harder: repeat this weight');
});

test('one set with something left in it stops the hold', () => {
  const suggestion = suggest(
    sessions([set(100, 10, { rpe: 10 }), set(100, 10, { rpe: 10 }), set(100, 10, { rpe: 8 })]),
  );

  assert.equal(suggestion.kind, 'add_reps', 'the third set had two reps in it. Ask for one');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.reps),
    [11, 11, 11],
  );
});

test('a cleared range still takes the weight, however hard it was', () => {
  const suggestion = suggest(sessions(rated(100, 12, 10)));

  assert.equal(suggestion.kind, 'add_weight', 'the step is what brings the next RPE back down');
  assert.deepEqual(suggestion.sets, [
    { workingIndex: 1, weightKg: 102.5, reps: 8 },
    { workingIndex: 2, weightKg: 102.5, reps: 8 },
    { workingIndex: 3, weightKg: 102.5, reps: 8 },
  ]);
  assert.equal(suggestion.reason, 'Cleared 12 reps on every set');
});

test('a stall is still a stall at RPE 10', () => {
  const short = rated(100, 6, 10);
  const suggestion = suggest(sessions(short, short, short));

  assert.equal(suggestion.kind, 'back_off', 'back_off is already the most cautious answer there is');
  assert.equal(suggestion.reason, 'Short of 8 reps for three sessions. Take 10% off');
});

test('an easy session under the band is held, not loaded', () => {
  // Contradictory evidence: short of the range, and reportedly easy. The engine
  // was going to hold, and neither rule is allowed to reach a hold.
  const suggestion = suggest(sessions(rated(100, 6, 6)));

  assert.equal(suggestion.kind, 'hold');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [100, 100, 100],
  );
  assert.equal(suggestion.reason, 'Short of 8 reps: repeat this weight');
});

test('work with nothing to load is never handed an early increment', () => {
  const suggestion = suggest(sessions(rated(null, 10, 6)), {
    trackingType: 'bodyweight_reps',
    incrementKg: defaultIncrementKg('bodyweight'),
  });

  assert.equal(suggestion.kind, 'add_reps');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [null, null, null],
    'there is no 2.5 kg to add to a push-up, whatever the RPE says',
  );
});

test('assistance comes off early too, rather than going on', () => {
  const suggestion = suggest(sessions(rated(40, 10, 6)), {
    trackingType: 'assisted_bodyweight',
  });

  assert.equal(suggestion.kind, 'add_weight');
  assert.deepEqual(
    suggestion.sets.map((entry) => entry.weightKg),
    [37.5, 37.5, 37.5],
    'reps to spare on assisted work means less help, not more',
  );
  assert.equal(suggestion.reason, 'Every set at RPE 6 or easier: take help off');
});

test('a target of ten moves both thresholds up the scale with it', () => {
  const early = suggest(sessions(rated(100, 10, 8)), { targetRpe: 10 });
  assert.equal(early.kind, 'add_weight', 'two in reserve is spare capacity when the target is zero');
  assert.equal(early.reason, 'Every set at RPE 8 or easier: add load now');

  // The brake would need RPE 12 to fire against a target of 10, and the scale
  // stops at 10, so a maximal session is simply the normal week again.
  const maximal = suggest(sessions(rated(100, 10, 10)), { targetRpe: 10 });
  assert.equal(maximal.kind, 'add_reps');
});

test('a target off the end of the scale is clamped rather than believed', () => {
  const suggestion = suggest(sessions(rated(100, 10, 8)), { targetRpe: 99 });

  assert.equal(suggestion.kind, 'add_weight', 'clamped to 10, which is the target above');
  assert.equal(suggestion.reason, 'Every set at RPE 8 or easier: add load now');
});

test('an effort off the scale is dropped, not clamped onto the end of it', () => {
  for (const rpe of [47, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const suggestion = suggest(sessions(rated(100, 10, rpe)));
    assert.equal(
      suggestion.kind,
      'add_reps',
      `an rpe of ${rpe} is a mis-mapped import, not an effort`,
    );
  }
});

test('the two effort lines are captions like every other reason', () => {
  const reasons = [
    suggest(sessions(rated(100, 10, 6))).reason,
    suggest(sessions(rated(100, 10, 10))).reason,
    suggest(sessions(rated(40, 10, 6)), { trackingType: 'assisted_bodyweight' }).reason,
    suggest(sessions(rated(100, 10, 6.5)), { targetRpe: 8.5 }).reason,
  ];

  for (const reason of reasons) {
    assert.ok(!reason.includes('\n'), `"${reason}" is more than one line`);
    assert.ok(!reason.endsWith('.'), `"${reason}" ends in a full stop`);
    assert.match(reason, /^[A-Z0-9]/, `"${reason}" is not sentence case`);
    assert.ok(reason.length < 60, `"${reason}" is too long for a caption`);
  }
});
