#!/usr/bin/env node
/**
 * The training history behind the screenshots in `screenshots/`.
 *
 * Every figure in the README's images comes from here: a year of a four-day
 * upper/lower/push/pull split, the body measurements taken alongside it, and
 * the four routines the sessions were run from. It is generated rather than
 * copied out of a real log for two reasons. Nobody's actual training data ends
 * up in the repository, and a seeded generator produces the same year every
 * time, so a screenshot retaken in six months still shows the same numbers as
 * the ones beside it.
 *
 * Nothing here touches a database or a browser. It emits plain objects in the
 * shape `@lift/shared/import` already defines (`ImportedWorkout`), which is
 * what lets `capture.mjs` hand the whole year to the app's own importer: the
 * same code path a Hevy export goes through, so volumes, estimated 1RMs and
 * personal records are computed by the app rather than asserted by this file.
 *
 *   node scripts/screenshots/sample-log.mjs        # summarises what it built
 *
 * The one input is the end date, which defaults to today. Sessions are laid
 * back from it so the last week is always populated: the statistics screen
 * draws a seven-day body map, and a log that stops a month ago renders it cold.
 */

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * mulberry32. Small, fast, and good enough for jitter on a rep count.
 *
 * Seeded once and threaded through every draw, so the whole year is a pure
 * function of the seed and the end date. Change either and every screenshot
 * has to be retaken; change neither and re-running this is a no-op.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260824;

/** Uniform in [min, max]. */
const between = (random, min, max) => min + random() * (max - min);

/** Integer in [min, max], both ends included. */
const pick = (random, min, max) => Math.floor(between(random, min, max + 1));

const chance = (random, probability) => random() < probability;

const choose = (random, values) => values[Math.floor(random() * values.length)];

/** Rounds to the nearest loadable increment: 2.5 kg on a bar, 2 kg on a rack. */
const toPlate = (kg, step) => Math.round(kg / step) * step;

// ---------------------------------------------------------------------------
// The program
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * A working set as prescribed, before progression and noise.
 *
 * `pct` is a fraction of the day's top weight, so a backoff set follows the top
 * set up automatically over the year instead of needing its own trend line.
 */
const set = (reps, pct = 1, extra = {}) => ({ reps, pct, ...extra });

/**
 * One exercise inside one session.
 *
 * `start` and `gain` describe a straight line in kilograms per week, which is
 * what an intermediate lifter's year actually looks like once the newbie phase
 * is over. The wobble around that line is added per session, not baked in here.
 */
function lift(name, { start, gain, step = 2.5, sets, warmups = [], rpe = [7, 9] }) {
  return { kind: 'weight', name, start, gain, step, sets, warmups, rpe };
}

/** Pull-ups and the like: the progression is in reps, not on the bar. */
function bodyweight(name, { startReps, gainReps, sets }) {
  return { kind: 'bodyweight', name, startReps, gainReps, sets };
}

/** Planks: one number, and it goes up. */
function hold(name, { startSeconds, gainSeconds, sets }) {
  return { kind: 'duration', name, startSeconds, gainSeconds, sets };
}

/** Conditioning: distance and the clock, tracked together. */
function cardio(name, { startKm, gainKm, paceSecPerKm }) {
  return { kind: 'cardio', name, startKm, gainKm, paceSecPerKm };
}

/**
 * The four sessions, on the days they are trained.
 *
 * Monday, Tuesday, Thursday and Saturday: two rest days mid-week and one at the
 * end, which is the shape most four-day splits settle into and, more to the
 * point here, the shape that fills a calendar screenshot legibly.
 */
const PROGRAM = [
  {
    weekday: 1,
    name: 'Push A',
    startHour: 18.25,
    /*
     * The two isolation lifts at the end, run back to back.
     *
     * Named rather than positional so reordering the day above cannot silently
     * pair the wrong two, and one superset rather than several because the
     * screenshot is meant to show what the feature looks like, not to argue
     * that every accessory should be supersetted.
     */
    superset: ['Lateral Raise (Dumbbell)', 'Triceps Rope Pushdown'],
    exercises: [
      lift('Barbell Bench Press', {
        start: 72.5,
        gain: 0.3,
        warmups: [0.5, 0.75],
        sets: [set(5), set(5), set(5), set(8, 0.87)],
      }),
      lift('Overhead Press (Barbell)', {
        start: 45,
        gain: 0.17,
        warmups: [0.6],
        sets: [set(6), set(6), set(8, 0.92)],
      }),
      lift('Incline Bench Press (Dumbbell)', {
        start: 24,
        gain: 0.13,
        step: 2,
        sets: [set(10), set(10), set(12, 0.92)],
      }),
      lift('Lateral Raise (Dumbbell)', {
        start: 10,
        gain: 0.07,
        step: 1,
        rpe: [8, 9.5],
        sets: [set(15), set(15), set(15, 1, { setType: 'drop' })],
      }),
      lift('Triceps Rope Pushdown', {
        start: 25,
        gain: 0.19,
        step: 2.5,
        rpe: [8, 9.5],
        sets: [set(12), set(12), set(15, 0.9)],
      }),
    ],
  },
  {
    weekday: 2,
    name: 'Pull B',
    startHour: 18.5,
    exercises: [
      lift('Barbell Deadlift', {
        start: 120,
        gain: 0.5,
        warmups: [0.5, 0.75],
        sets: [set(5), set(5, 0.92), set(5, 0.92)],
      }),
      bodyweight('Pull-up', { startReps: 7, gainReps: 0.1, sets: 4 }),
      lift('Barbell Bent Over Row', {
        start: 60,
        gain: 0.26,
        warmups: [0.6],
        sets: [set(8), set(8), set(8), set(10, 0.9)],
      }),
      lift('Lat Pulldown (Cable)', {
        start: 55,
        gain: 0.21,
        sets: [set(10), set(10), set(12, 0.9)],
      }),
      lift('Face Pull', {
        start: 20,
        gain: 0.1,
        rpe: [7, 8.5],
        sets: [set(15), set(15), set(15)],
      }),
      lift('Hammer Curl (Dumbbell)', {
        start: 14,
        gain: 0.08,
        step: 2,
        rpe: [8, 9.5],
        sets: [set(12), set(12), set(12, 0.93)],
      }),
    ],
  },
  {
    weekday: 4,
    name: 'Legs C',
    startHour: 18.25,
    exercises: [
      lift('Barbell Squat', {
        start: 95,
        gain: 0.45,
        warmups: [0.45, 0.7],
        sets: [set(5), set(5), set(5), set(8, 0.85)],
      }),
      lift('Romanian Deadlift (Barbell)', {
        start: 80,
        gain: 0.31,
        sets: [set(8), set(8), set(10, 0.9)],
      }),
      lift('Leg Press (Machine)', {
        start: 160,
        gain: 0.95,
        step: 5,
        sets: [set(12), set(12), set(15, 0.88)],
      }),
      lift('Lying Leg Curl (Machine)', {
        start: 40,
        gain: 0.2,
        rpe: [8, 9.5],
        sets: [set(12), set(12), set(12)],
      }),
      lift('Standing Calf Raise (Machine)', {
        start: 60,
        gain: 0.36,
        rpe: [8, 9.5],
        sets: [set(15), set(15), set(15), set(20, 0.85)],
      }),
      bodyweight('Hanging Leg Raise', { startReps: 11, gainReps: 0.09, sets: 3 }),
    ],
  },
  {
    weekday: 6,
    name: 'Upper D',
    startHour: 9.5,
    exercises: [
      lift('Chest Dip (Weighted)', {
        start: 5,
        gain: 0.16,
        step: 1.25,
        sets: [set(8), set(8), set(10, 0.8)],
      }),
      lift('Seated Cable Row - V Grip (Cable)', {
        start: 60,
        gain: 0.26,
        sets: [set(10), set(10), set(10), set(12, 0.9)],
      }),
      lift('Barbell Curl', {
        start: 30,
        gain: 0.13,
        rpe: [8, 9.5],
        sets: [set(10), set(10), set(10, 0.9, { setType: 'failure' })],
      }),
      lift('Cable Crunch', {
        start: 35,
        gain: 0.16,
        rpe: [8, 9],
        sets: [set(15), set(15), set(15)],
      }),
      hold('Plank', { startSeconds: 60, gainSeconds: 1.7, sets: 3 }),
      cardio('Running', { startKm: 3, gainKm: 0.06, paceSecPerKm: 330 }),
    ],
  },
];

/** Every exercise name the program uses, for the routines and for validation. */
export const EXERCISE_NAMES = [
  ...new Set(PROGRAM.flatMap((day) => day.exercises.map((exercise) => exercise.name))),
];

// ---------------------------------------------------------------------------
// A year of it
// ---------------------------------------------------------------------------

/** How many weeks the log covers. Fifty-two would put the first week's numbers
 * on the same day of the year as the last week's, which reads as a typo in the
 * history list rather than as a coincidence. */
const WEEKS = 51;

/** Every eighth week is lighter: fewer sets, and the bar comes back a step. */
const DELOAD_EVERY = 8;
const DELOAD_FACTOR = 0.86;

/** Sessions missed for the ordinary reasons. Roughly one every three weeks. */
const SKIP_CHANCE = 0.08;

/** A fortnight away from the gym, so the calendar has a gap that means
 * something and the week-streak figure has a story behind it. */
const AWAY_WEEKS = new Set([15, 16]);

const SESSION_NOTES = [
  'Bar speed was good on the top set. Adding weight next week.',
  'Slept badly. Kept the working sets and cut the accessories short.',
  'Elbows were talking on the last set, so the drop set went lighter.',
  'New gym, new bar. Felt heavier than the number says.',
  'Warmed up properly for once and everything moved better for it.',
  'Straps for the last two sets. Grip gave out before the back did.',
];

const EXERCISE_NOTES = {
  'Barbell Bench Press': 'Pause on the chest, no bounce.',
  'Barbell Squat': 'Belt on from the second working set.',
  'Barbell Deadlift': 'Double overhand until it slips, then mixed.',
  'Pull-up': 'Dead hang at the bottom of every rep.',
};

/**
 * Builds the whole log.
 *
 * `endedOn` is the day the last session falls on or before, and defaults to
 * today. Everything is laid backwards from there.
 */
export function buildSampleLog({ endedOn = new Date(), seed = SEED } = {}) {
  const random = rng(seed);

  // Anchor on the Monday of the current week so the weekday offsets below land
  // where they are meant to, then step back a year of weeks.
  const anchor = startOfDay(endedOn);
  anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  const firstMonday = new Date(anchor.getTime() - (WEEKS - 1) * 7 * DAY_MS);

  const workouts = [];

  for (let week = 0; week < WEEKS; week += 1) {
    if (AWAY_WEEKS.has(week)) continue;

    const deload = week > 0 && (week + 1) % DELOAD_EVERY === 0;

    for (const day of PROGRAM) {
      const date = new Date(firstMonday.getTime() + (week * 7 + day.weekday - 1) * DAY_MS);
      if (date > endedOn) continue;
      if (chance(random, SKIP_CHANCE)) continue;

      const session = buildSession({ day, week, date, deload, random });

      // Today's session may not have happened yet. A workout dated an hour from
      // now is not a screenshot of a training log, it is a bug report.
      if (session.finishedAt > endedOn.getTime()) continue;

      workouts.push(session);
    }
  }

  return {
    workouts,
    measurements: buildMeasurements(firstMonday, endedOn, random),
    routines: buildRoutines(),
    settings: {
      heightCm: 180,
      sex: 'male',
      bodyweightKg: 84.1,
      weightUnit: 'kg',
      firstDayOfWeek: 1,
    },
  };
}

function buildSession({ day, week, date, deload, random }) {
  const startedAt = new Date(date);
  startedAt.setHours(Math.floor(day.startHour), (day.startHour % 1) * 60 + pick(random, -12, 12), 0, 0);

  const exercises = [];

  for (const exercise of day.exercises) {
    // Conditioning is not every week: it is what gets dropped when the session
    // has already run long, which is also why it sits last in the day.
    if (exercise.kind === 'cardio' && !chance(random, 0.55)) continue;

    const sets = buildSets(exercise, week, deload, random);
    if (sets.length === 0) continue;

    exercises.push({
      name: exercise.name,
      notes: chance(random, 0.08) ? (EXERCISE_NOTES[exercise.name] ?? null) : null,
      supersetGroup: null,
      sets,
    });
  }

  const minutes = Math.round(
    exercises.reduce((total, exercise) => total + exercise.sets.length * 3.1, 12) +
      between(random, -6, 8),
  );

  const finishedAt = new Date(startedAt.getTime() + minutes * 60_000);

  return {
    name: deload ? `${day.name} (deload)` : day.name,
    notes: chance(random, 0.14) ? choose(random, SESSION_NOTES) : null,
    startedAt: startedAt.getTime(),
    finishedAt: finishedAt.getTime(),
    durationSeconds: minutes * 60,
    exercises,
  };
}

function buildSets(exercise, week, deload, random) {
  if (exercise.kind === 'bodyweight') {
    const base = exercise.startReps + exercise.gainReps * week * (deload ? 0.85 : 1);
    return Array.from({ length: exercise.sets }, (_, index) => ({
      setType: 'normal',
      weightKg: null,
      reps: Math.max(3, Math.round(base - index * 1.2 + between(random, -1, 1))),
      durationSeconds: null,
      distanceKm: null,
      rpe: round(between(random, 7.5, 9.5), 1),
    }));
  }

  if (exercise.kind === 'duration') {
    const base = exercise.startSeconds + exercise.gainSeconds * week;
    return Array.from({ length: exercise.sets }, (_, index) => ({
      setType: 'normal',
      weightKg: null,
      reps: null,
      durationSeconds: Math.round((base - index * 8 + between(random, -5, 5)) / 5) * 5,
      distanceKm: null,
      rpe: null,
    }));
  }

  if (exercise.kind === 'cardio') {
    const km = round(exercise.startKm + exercise.gainKm * week + between(random, -0.4, 0.4), 1);
    return [
      {
        setType: 'normal',
        weightKg: null,
        reps: null,
        durationSeconds: Math.round(km * exercise.paceSecPerKm * between(random, 0.94, 1.04)),
        distanceKm: km,
        rpe: null,
      },
    ];
  }

  // The day's top weight: the trend line, a little week-to-week noise, and the
  // deload if this is one of those weeks.
  const trend = exercise.start + exercise.gain * week;
  const top = toPlate(trend * between(random, 0.985, 1.02) * (deload ? DELOAD_FACTOR : 1), exercise.step);

  const sets = [];

  for (const fraction of exercise.warmups) {
    sets.push({
      setType: 'warmup',
      weightKg: toPlate(top * fraction, exercise.step),
      reps: fraction < 0.6 ? 8 : 5,
      durationSeconds: null,
      distanceKm: null,
      rpe: null,
    });
  }

  // A deload drops the last working set as well as the bar.
  const working = deload ? exercise.sets.slice(0, -1) : exercise.sets;

  for (const [index, prescribed] of working.entries()) {
    sets.push({
      setType: prescribed.setType ?? 'normal',
      weightKg: toPlate(top * prescribed.pct, exercise.step),
      // Fatigue: the last set of a group tends to come up a rep short.
      reps: Math.max(1, prescribed.reps - (index === working.length - 1 ? pick(random, 0, 2) : pick(random, 0, 1))),
      durationSeconds: null,
      distanceKm: null,
      rpe: round(between(random, exercise.rpe[0], exercise.rpe[1]), 1),
    });
  }

  return sets;
}

// ---------------------------------------------------------------------------
// Body measurements
// ---------------------------------------------------------------------------

/**
 * A weekly weigh-in and a monthly tape.
 *
 * The trend is a lean bulk: bodyweight up about six kilos across the year while
 * body fat comes down two points, which is what makes the derived figures on
 * the measurements screen (BMI, the Navy body-fat estimate) worth a screenshot
 * rather than three copies of the same flat line.
 */
function buildMeasurements(firstMonday, endedOn, random) {
  const entries = [];

  const weeks = Math.floor((startOfDay(endedOn) - firstMonday) / (7 * DAY_MS));

  for (let week = 0; week <= weeks; week += 1) {
    const date = new Date(firstMonday.getTime() + week * 7 * DAY_MS);
    date.setHours(7, pick(random, 5, 55), 0, 0);
    if (date > endedOn) break;

    const progress = week / Math.max(1, weeks);

    entries.push({
      kind: 'bodyweight',
      // Weight does not climb monotonically. The wobble is most of why anyone
      // plots it at all.
      value: round(78.2 + progress * 5.9 + Math.sin(week / 3.1) * 0.55 + between(random, -0.4, 0.4), 1),
      measuredAt: date.getTime(),
    });

    if (week % 4 !== 0) continue;

    const tape = [
      ['body_fat', 17.8 - progress * 3.4, 0.3],
      ['neck', 38.5 + progress * 1.2, 0.2],
      ['shoulders', 122 + progress * 5.5, 0.5],
      ['chest', 102 + progress * 5.2, 0.4],
      ['left_bicep', 36.4 + progress * 2.6, 0.2],
      ['right_bicep', 36.8 + progress * 2.7, 0.2],
      ['waist', 82.5 - progress * 1.4, 0.3],
      ['hips', 98 + progress * 1.1, 0.3],
      ['left_thigh', 58.2 + progress * 3.4, 0.3],
      ['right_thigh', 58.6 + progress * 3.5, 0.3],
      ['left_calf', 38.1 + progress * 1.5, 0.2],
      ['right_calf', 38.3 + progress * 1.6, 0.2],
    ];

    for (const [kind, value, noise] of tape) {
      entries.push({
        kind,
        value: round(value + between(random, -noise, noise), 1),
        measuredAt: date.getTime(),
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

/**
 * The four routines the sessions were run from, as targets rather than as
 * performed work: the last week's weights, rounded, with the prescribed reps.
 *
 * Built from the same `PROGRAM` the history is, so a routine can never come to
 * disagree with the sessions it supposedly produced.
 */
function buildRoutines() {
  return PROGRAM.map((day) => ({
    name: day.name,
    notes: null,
    exercises: day.exercises.map((exercise) => ({
      name: exercise.name,
      // One group id per day is enough: the column is only ever read against
      // the exercises of a single routine, so two days may both use 1 without
      // ever meeting. `supersets.ts` in `@lift/shared` requires the members to
      // be adjacent, which the day's own order already makes them.
      supersetGroup: day.superset?.includes(exercise.name) ? 1 : null,
      sets: prescribedSets(exercise),
    })),
  }));
}

function prescribedSets(exercise) {
  if (exercise.kind === 'bodyweight') {
    return Array.from({ length: exercise.sets }, () => ({
      targetReps: Math.round(exercise.startReps + exercise.gainReps * WEEKS),
      targetWeightKg: null,
    }));
  }

  if (exercise.kind === 'duration' || exercise.kind === 'cardio') {
    return [{ targetReps: null, targetWeightKg: null }];
  }

  const top = toPlate(exercise.start + exercise.gain * (WEEKS - 1), exercise.step);

  return exercise.sets.map((prescribed) => ({
    targetReps: prescribed.reps,
    targetWeightKg: toPlate(top * prescribed.pct, exercise.step),
  }));
}

// ---------------------------------------------------------------------------
// Odds and ends
// ---------------------------------------------------------------------------

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** What the log adds up to, for the line `capture.mjs` prints and for `--help`. */
export function summarise(log) {
  const sets = log.workouts.reduce((total, workout) => total + workout.exercises.reduce((n, e) => n + e.sets.length, 0), 0);

  const volume = log.workouts.reduce(
    (total, workout) =>
      total +
      workout.exercises.reduce(
        (n, exercise) =>
          n +
          exercise.sets.reduce(
            (v, s) => v + (s.setType === 'warmup' ? 0 : (s.weightKg ?? 0) * (s.reps ?? 0)),
            0,
          ),
        0,
      ),
    0,
  );

  return {
    workouts: log.workouts.length,
    sets,
    exercises: EXERCISE_NAMES.length,
    measurements: log.measurements.length,
    routines: log.routines.length,
    volumeTonnes: Math.round(volume / 1000),
    from: new Date(log.workouts[0].startedAt).toISOString().slice(0, 10),
    to: new Date(log.workouts[log.workouts.length - 1].startedAt).toISOString().slice(0, 10),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(summarise(buildSampleLog()));
}
