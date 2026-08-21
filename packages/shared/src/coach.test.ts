import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCoachPrompt,
  coachFileName,
  estimateTokens,
  type CoachExercise,
  type CoachReport,
  type CoachRoutine,
  type CoachSession,
  type CoachSet,
} from './coach.ts';

/**
 * Dates are built from local parts rather than from ISO strings.
 *
 * The document stamps a session with the day the user had, so a UTC literal
 * would put these assertions a day out for anyone running the suite west of
 * Greenwich — which is exactly the bug the local stamping exists to avoid.
 */
function localDay(year: number, month: number, day: number, hour = 18): number {
  return new Date(year, month - 1, day, hour, 30).getTime();
}

function set(overrides: Partial<CoachSet> = {}): CoachSet {
  return {
    setType: 'normal',
    weightKg: 100,
    reps: 5,
    durationSeconds: null,
    distanceKm: null,
    rpe: null,
    ...overrides,
  };
}

function exercise(overrides: Partial<CoachExercise> = {}): CoachExercise {
  return {
    name: 'Bench Press (Barbell)',
    equipment: 'barbell',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    trackingType: 'weight_reps',
    notes: null,
    supersetGroup: null,
    sets: [set({ setType: 'warmup', weightKg: 40, reps: 10 }), set(), set({ reps: 4, rpe: 9 })],
    ...overrides,
  };
}

function session(overrides: Partial<CoachSession> = {}): CoachSession {
  return {
    startedAt: localDay(2026, 4, 14),
    name: 'Push A',
    durationSeconds: 3960,
    notes: null,
    volumeKg: 900,
    sets: 2,
    reps: 9,
    prCount: 0,
    exercises: [exercise()],
    ...overrides,
  };
}

function routine(overrides: Partial<CoachRoutine> = {}): CoachRoutine {
  return {
    name: 'Upper A',
    notes: null,
    lastPerformedAt: localDay(2026, 4, 12),
    exercises: [
      {
        name: 'Bench Press (Barbell)',
        equipment: 'barbell',
        primaryMuscle: 'chest',
        notes: null,
        restSeconds: 120,
        supersetGroup: null,
        sets: [
          {
            setType: 'normal',
            reps: 8,
            weightKg: 80,
            rpe: null,
            durationSeconds: null,
            distanceKm: null,
          },
          {
            setType: 'normal',
            reps: 8,
            weightKg: 80,
            rpe: null,
            durationSeconds: null,
            distanceKm: null,
          },
          {
            setType: 'normal',
            reps: 8,
            weightKg: 80,
            rpe: null,
            durationSeconds: null,
            distanceKm: null,
          },
          {
            setType: 'normal',
            reps: 5,
            weightKg: 90,
            rpe: 9,
            durationSeconds: null,
            distanceKm: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function report(overrides: Partial<CoachReport> = {}): CoachReport {
  return {
    generatedAt: localDay(2026, 4, 15, 9),
    from: localDay(2026, 3, 16, 0),
    to: localDay(2026, 4, 16, 0),
    rangeLabel: 'Last 30 days',
    weeks: 4.3,
    profile: {
      weightUnit: 'kg',
      distanceUnit: 'km',
      measurementUnit: 'cm',
      bodyweightKg: 82,
      heightCm: 180,
      sex: 'male',
      note: null,
    },
    totals: {
      workouts: 12,
      activeDays: 11,
      sets: 140,
      reps: 1200,
      volumeKg: 84000,
      durationSeconds: 43200,
      prs: 3,
    },
    muscles: [
      {
        muscle: 'chest',
        sets: 43,
        directSets: 40,
        exercises: 4,
        setsPerWeek: 10,
      },
      {
        muscle: 'cardio',
        sets: 4,
        directSets: 4,
        exercises: 1,
        setsPerWeek: 1,
      },
    ],
    sessions: [session()],
    routines: [routine()],
    records: [
      {
        exercise: 'Bench Press (Barbell)',
        kind: 'heaviest_weight',
        value: 102.5,
        reps: 3,
        achievedAt: localDay(2026, 4, 12),
      },
    ],
    measurements: [{ kind: 'bodyweight', value: 82, measuredAt: localDay(2026, 4, 12, 8) }],
    bodyweightSeries: [
      { kind: 'bodyweight', value: 81, measuredAt: localDay(2026, 3, 16, 8) },
      { kind: 'bodyweight', value: 82, measuredAt: localDay(2026, 4, 12, 8) },
    ],
    omittedSessions: 0,
    sessionsIncluded: true,
    routinesIncluded: true,
    ...overrides,
  };
}

describe('buildCoachPrompt', () => {
  it('asks for criticism rather than feedback', () => {
    const text = buildCoachPrompt(report());

    // The brief is the whole point of the export: without it the model writes
    // four paragraphs of encouragement about a log it was handed.
    assert.match(text, /What is holding me back/);
    assert.match(text, /Skip the encouragement/);
    assert.match(text, /Do not invent work I did not do/);
  });

  it('lays the document out in the order a reviewer reads it', () => {
    const text = buildCoachPrompt(report());

    const order = [
      '# Training review request',
      '## About me',
      '## The window',
      '## Weekly sets per muscle',
      '## Session log',
      '## Routines',
      '## Current personal bests',
      '## Body measurements',
      '## How to read this',
    ];

    let cursor = -1;
    for (const heading of order) {
      const at = text.indexOf(heading);
      assert.ok(at > cursor, `${heading} is missing or out of order`);
      cursor = at;
    }
  });

  it('numbers working sets and marks warm-ups without numbering them', () => {
    const text = buildCoachPrompt(report());

    assert.match(text, /- W: 40 kg × 10/);
    assert.match(text, /- 1: 100 kg × 5/);
    assert.match(text, /- 2: 100 kg × 4 · RPE 9/);
    // The warm-up would have been "3" if it counted, which is the number no
    // total in the app includes.
    assert.doesNotMatch(text, /- 3: /);
  });

  it('writes every set of every session out', () => {
    const sessions = [
      session({ startedAt: localDay(2026, 4, 10) }),
      session({ startedAt: localDay(2026, 4, 12), name: 'Pull A' }),
      session({ startedAt: localDay(2026, 4, 14) }),
    ];

    const text = buildCoachPrompt(report({ sessions }));
    const setLines = text.split('\n').filter((line) => /^- (W|\d+): /.test(line));

    assert.equal(setLines.length, 9);
  });

  it('stamps sessions with an unambiguous date and its weekday', () => {
    const text = buildCoachPrompt(report());
    assert.match(text, /### 2026-04-14 \(Tue\) · Push A/);
  });

  it('prints every figure in the requested unit', () => {
    const text = buildCoachPrompt(
      report({
        profile: {
          weightUnit: 'lb',
          distanceUnit: 'mi',
          measurementUnit: 'in',
          bodyweightKg: 82,
          heightCm: 180,
          sex: null,
          note: null,
        },
      }),
    );

    assert.match(text, /180.78 lb/);
    assert.match(text, /Weights are in lb/);
    // A stray kilogram anywhere in the document is the failure this whole
    // feature is most likely to ship with: the numbers still look plausible.
    assert.doesNotMatch(text, /\d kg/);
    assert.doesNotMatch(text, /\d cm/);
  });

  it('judges each muscle against its own landmarks, and says when it has none', () => {
    const text = buildCoachPrompt(report());

    // Chest at 10 sets a week is exactly its MEV — the first rate that counts
    // as growing rather than maintaining.
    assert.match(text, /\| Chest \| 10 \| 40 \| 4 \| 10 \| 20 \| 22 \| Growing \|/);
    // Cardio is not a muscle and has no thresholds to be judged against. A row
    // of real-looking numbers here would tell someone their running is past its
    // maximum recoverable volume.
    assert.match(text, /\| Cardio \| 1 \| 4 \| 1 \| — \| — \| — \| no landmark \|/);
  });

  it('collapses identical prescribed sets and keeps the odd one out', () => {
    const text = buildCoachPrompt(report());

    assert.match(text, /- 3 × 8 reps @ 80 kg/);
    assert.match(text, /- 1 × 5 reps @ 90 kg · RPE 9/);
  });

  it('says what a capped session log left out, and that the totals did not', () => {
    const text = buildCoachPrompt(report({ omittedSessions: 44 }));

    assert.match(text, /The most recent session of 45 in the window/);
    assert.match(text, /the totals and the set counts above still cover all of them/);
  });

  it('distinguishes an empty window from a section turned off', () => {
    const empty = buildCoachPrompt(report({ sessions: [], routines: [] }));
    assert.match(empty, /No finished sessions in this window/);
    assert.match(empty, /I have no saved routines/);

    const withheld = buildCoachPrompt(
      report({ sessionsIncluded: false, routinesIncluded: false, sessions: [], routines: [] }),
    );
    assert.match(withheld, /Left out of this export on purpose/);
    // Both sections say it, and neither claims the log is empty.
    assert.doesNotMatch(withheld, /No finished sessions/);
  });

  it('quotes free text on every line so a note cannot become a heading', () => {
    const text = buildCoachPrompt(
      report({
        sessions: [session({ notes: 'felt heavy\n# not a heading' })],
      }),
    );

    assert.match(text, /> felt heavy\n> # not a heading/);
  });

  it('carries the user’s own words through', () => {
    const text = buildCoachPrompt(
      report({
        profile: {
          weightUnit: 'kg',
          distanceUnit: 'km',
          measurementUnit: 'cm',
          bodyweightKg: 82,
          heightCm: null,
          sex: null,
          note: 'I want bigger arms and my left shoulder clicks.',
        },
      }),
    );

    assert.match(text, /> I want bigger arms and my left shoulder clicks\./);
    assert.match(text, /Height: not recorded/);
  });

  it('warns that bodyweight work is uncounted when no bodyweight is on record', () => {
    const withWeight = buildCoachPrompt(report());
    assert.doesNotMatch(withWeight, /contributes zero volume/);

    const without = buildCoachPrompt(
      report({
        profile: {
          weightUnit: 'kg',
          distanceUnit: 'km',
          measurementUnit: 'cm',
          bodyweightKg: null,
          heightCm: null,
          sex: null,
          note: null,
        },
      }),
    );
    assert.match(without, /contributes zero volume/);
    assert.match(without, /treat any bodyweight exercise below as unloaded reps/);
  });

  it('reads a bodyweight trend as a direction, not a column', () => {
    const text = buildCoachPrompt(report());
    assert.match(text, /81 kg on 2026-03-16 → 82 kg on 2026-04-12 \(up 1 kg across 2 weigh-ins\)/);
  });

  it('leaves out sections it has nothing for', () => {
    const text = buildCoachPrompt(
      report({ records: [], measurements: [], bodyweightSeries: [] }),
    );

    assert.doesNotMatch(text, /## Current personal bests/);
    assert.doesNotMatch(text, /## Body measurements/);
  });

  it('describes timed and distance work without inventing a load', () => {
    const text = buildCoachPrompt(
      report({
        sessions: [
          session({
            exercises: [
              exercise({
                name: 'Plank',
                equipment: 'bodyweight',
                primaryMuscle: 'abs',
                trackingType: 'duration',
                sets: [set({ weightKg: null, reps: null, durationSeconds: 90 })],
              }),
              exercise({
                name: 'Running',
                equipment: 'cardio_machine',
                primaryMuscle: 'cardio',
                trackingType: 'distance_duration',
                sets: [set({ weightKg: null, reps: null, distanceKm: 5, durationSeconds: 1650 })],
              }),
            ],
          }),
        ],
      }),
    );

    assert.match(text, /- 1: 1:30/);
    assert.match(text, /- 1: 5 km · 27:30/);
  });

  it('reads an assisted set as assistance rather than as load', () => {
    const text = buildCoachPrompt(
      report({
        sessions: [
          session({
            exercises: [
              exercise({
                name: 'Assisted Pull Up',
                trackingType: 'assisted_bodyweight',
                sets: [set({ weightKg: 20, reps: 8 })],
              }),
            ],
          }),
        ],
      }),
    );

    assert.match(text, /−20 kg assistance × 8/);
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
  });
});

describe('coachFileName', () => {
  it('is dated, sortable and obviously ours', () => {
    assert.equal(coachFileName(localDay(2026, 4, 5, 9)), 'lift-review-2026-04-05.md');
  });
});
