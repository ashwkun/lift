import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCsv } from './csv.ts';
import { collapseHeader, detectSource, resolveColumns } from './columns.ts';
import { exerciseMatchKey, inferEquipment, inferTrackingType } from './exercises.ts';
import {
  collectExerciseNames,
  countSets,
  filterWorkoutsSince,
  ImportFormatError,
  importCutoff,
  parseWorkoutCsv,
} from './parse.ts';
import {
  detectDateOrder,
  parseNumber,
  parseSeconds,
  parseSetType,
  parseTimestamp,
} from './values.ts';

/** Local wall-clock, so these assertions hold in every timezone CI runs in. */
const local = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number => new Date(year, month - 1, day, hour, minute, second).getTime();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real Hevy export, trimmed. Header and quoting are verbatim. */
const HEVY_CSV = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Seated Leg Curl (Machine)",,"",0,"warmup",52,5,,,
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Seated Leg Curl (Machine)",,"",1,"normal",60,5,,,
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Leg Extension (Machine)",,"slow negatives",0,"normal",75,8,,,8
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Leg Extension (Machine)",,"slow negatives",1,"failure",70,7,,,10
"upper 1","19 May 2025, 22:24","19 May 2025, 23:30","","Incline Bench Press (Dumbbell)",,"",0,"normal",72,4,,,
"upper 1","19 May 2025, 22:24","19 May 2025, 23:30","","Lat Pulldown (Cable)",,"",0,"normal",85,6,,,`;

/** What `writeCsvFile` in `features/backup` produces. */
const LIFT_CSV = `Date,Workout,Exercise,Set Type,Weight (kg),Reps,Duration (s),Distance (km),RPE
2026-08-18T17:30:00.000Z,Push day,Bench Press (Barbell),warmup,40,10,,,
2026-08-18T17:30:00.000Z,Push day,Bench Press (Barbell),normal,80,5,,,9
2026-08-18T17:30:00.000Z,Push day,Plank,normal,,,90,,`;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('reads quoted fields containing the delimiter, quotes and newlines', () => {
    const table = parseCsv('a,b\n"x,1","he said ""hi""\nand left"\n');

    assert.deepEqual(table.header, ['a', 'b']);
    assert.deepEqual(table.rows, [['x,1', 'he said "hi"\nand left']]);
  });

  it('detects a semicolon delimiter', () => {
    const table = parseCsv('Date;Exercise;Weight\n2025-01-02;Squat;100');

    assert.equal(table.delimiter, ';');
    assert.deepEqual(table.header, ['Date', 'Exercise', 'Weight']);
  });

  it('strips the byte-order mark Excel writes', () => {
    const table = parseCsv('﻿title,reps\nlegs,5');
    assert.deepEqual(table.header, ['title', 'reps']);
  });

  it('pads short rows and drops the trailing blank line', () => {
    const table = parseCsv('a,b,c\n1,2\n');
    assert.deepEqual(table.rows, [['1', '2', '']]);
  });

  it('handles CRLF and lone-CR line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n').rows, [['1', '2']]);
    assert.deepEqual(parseCsv('a,b\r1,2').rows, [['1', '2']]);
  });
});

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

describe('resolveColumns', () => {
  it('collapses the three spellings of the same header', () => {
    assert.equal(collapseHeader('Weight (kg)'), 'weight kg');
    assert.equal(collapseHeader('weight_kg'), 'weight kg');
    assert.equal(collapseHeader('weightKg'), 'weight kg');
  });

  it('maps a Hevy header', () => {
    const { index } = resolveColumns(parseCsv(HEVY_CSV).header);

    assert.equal(index.workoutTitle, 0);
    assert.equal(index.startTime, 1);
    assert.equal(index.endTime, 2);
    assert.equal(index.workoutNotes, 3);
    assert.equal(index.exercise, 4);
    assert.equal(index.supersetId, 5);
    assert.equal(index.exerciseNotes, 6);
    assert.equal(index.setIndex, 7);
    assert.equal(index.setType, 8);
    assert.equal(index.weight, 9);
    assert.equal(index.reps, 10);
    assert.equal(index.distance, 11);
    assert.equal(index.setDuration, 12);
    assert.equal(index.rpe, 13);
  });

  it('gives "exercise title" to the exercise rather than the workout', () => {
    const { index } = resolveColumns(['title', 'exercise title', 'reps']);

    assert.equal(index.workoutTitle, 0);
    assert.equal(index.exercise, 1);
  });

  it('does not let one column serve two fields', () => {
    const { index } = resolveColumns(['Set', 'Set Type', 'Reps']);

    assert.equal(index.setType, 1);
    assert.equal(index.setIndex, 0);
  });

  it('reads the unit out of the weight header', () => {
    assert.equal(resolveColumns(['Weight (lbs)']).weightUnit, 'lb');
    assert.equal(resolveColumns(['weight_kg']).weightUnit, 'kg');
    assert.equal(resolveColumns(['Weight']).weightUnit, null);
  });

  it('reports headers it made no use of', () => {
    const { unmatched } = resolveColumns(['title', 'exercise', 'reps', 'mood']);
    assert.deepEqual(unmatched, ['mood']);
  });
});

describe('detectSource', () => {
  it('recognises the apps it knows by name', () => {
    assert.equal(detectSource(parseCsv(HEVY_CSV).header), 'hevy');
    assert.equal(detectSource(parseCsv(LIFT_CSV).header), 'lift');
    assert.equal(detectSource(['excercise name', 'reps']), 'lyfta');
  });

  it('does not refuse a file it cannot place', () => {
    assert.equal(detectSource(['when', 'movement', 'reps']), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

describe('parseNumber', () => {
  it('reads both decimal conventions', () => {
    assert.equal(parseNumber('52.5'), 52.5);
    assert.equal(parseNumber('52,5'), 52.5);
    assert.equal(parseNumber('1,234.56'), 1234.56);
    assert.equal(parseNumber('1.234,56'), 1234.56);
    assert.equal(parseNumber('1,234'), 1234);
  });

  it('strips a unit the exporter put in the cell', () => {
    assert.equal(parseNumber('100 kg'), 100);
    assert.equal(parseNumber('225lbs'), 225);
  });

  it('returns null for the many spellings of nothing', () => {
    for (const blank of ['', '   ', '-', 'null', 'N/A']) {
      assert.equal(parseNumber(blank), null, blank);
    }
  });

  it('keeps zero, which is a real bodyweight load', () => {
    assert.equal(parseNumber('0'), 0);
  });
});

describe('parseSeconds', () => {
  it('reads counts, clocks and spelled-out spans', () => {
    assert.equal(parseSeconds('90'), 90);
    assert.equal(parseSeconds('2:30'), 150);
    assert.equal(parseSeconds('01:06:25'), 3985);
    assert.equal(parseSeconds('1h 30m'), 5400);
    assert.equal(parseSeconds('45s'), 45);
  });

  it('reads a two-part clock as minutes and seconds', () => {
    assert.equal(parseSeconds('2:30'), 150);
  });

  it('returns null rather than zero when there is nothing to read', () => {
    assert.equal(parseSeconds(''), null);
    assert.equal(parseSeconds('soon'), null);
  });
});

describe('parseTimestamp', () => {
  it("reads Hevy's format", () => {
    assert.equal(parseTimestamp('21 May 2025, 20:44'), local(2025, 5, 21, 20, 44));
  });

  it('reads ISO with and without a zone', () => {
    assert.equal(parseTimestamp('2026-08-18T17:30:00.000Z'), Date.UTC(2026, 7, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18T17:30:00'), local(2026, 8, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18 17:30'), local(2026, 8, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18'), local(2026, 8, 18));
  });

  it('reads a twelve-hour clock', () => {
    assert.equal(parseTimestamp('5/21/2025 8:44 PM', 'mdy'), local(2025, 5, 21, 20, 44));
    assert.equal(parseTimestamp('5/21/2025 12:30 AM', 'mdy'), local(2025, 5, 21, 0, 30));
  });

  it('honours the day/month order it is given', () => {
    assert.equal(parseTimestamp('5/6/2025', 'dmy'), local(2025, 6, 5));
    assert.equal(parseTimestamp('5/6/2025', 'mdy'), local(2025, 5, 6));
  });

  it('lets an impossible month override the order', () => {
    assert.equal(parseTimestamp('21/05/2025', 'mdy'), local(2025, 5, 21));
  });

  it('rejects a date that would silently roll over', () => {
    assert.equal(parseTimestamp('31/02/2025'), null);
  });

  it('rejects text and implausible years', () => {
    assert.equal(parseTimestamp('yesterday'), null);
    assert.equal(parseTimestamp('01 Jan 1923, 10:00'), null);
  });

  it('reads epoch seconds and milliseconds', () => {
    assert.equal(parseTimestamp('1747852800'), 1747852800000);
    assert.equal(parseTimestamp('1747852800000'), 1747852800000);
  });
});

describe('detectDateOrder', () => {
  it('takes one unambiguous row as evidence for the column', () => {
    assert.equal(detectDateOrder(['01/02/2025', '21/05/2025']), 'dmy');
    assert.equal(detectDateOrder(['01/02/2025', '05/21/2025']), 'mdy');
  });

  it('falls back to day-first when nothing settles it', () => {
    assert.equal(detectDateOrder(['01/02/2025', '03/04/2025']), 'dmy');
    assert.equal(detectDateOrder([]), 'dmy');
  });
});

describe('parseSetType', () => {
  it('maps the four Lift stores exactly', () => {
    assert.deepEqual(parseSetType('warmup'), { type: 'warmup', exact: true });
    assert.deepEqual(parseSetType('Warm Up'), { type: 'warmup', exact: true });
    assert.deepEqual(parseSetType('dropset'), { type: 'drop', exact: true });
    assert.deepEqual(parseSetType('failure'), { type: 'failure', exact: true });
    assert.deepEqual(parseSetType('normal'), { type: 'normal', exact: true });
    assert.deepEqual(parseSetType(''), { type: 'normal', exact: true });
  });

  it('flags the ones it had to flatten', () => {
    assert.deepEqual(parseSetType('amrap'), { type: 'normal', exact: false });
    assert.deepEqual(parseSetType('myoreps'), { type: 'normal', exact: false });
  });
});

// ---------------------------------------------------------------------------
// Whole files
// ---------------------------------------------------------------------------

describe('parseWorkoutCsv: Hevy', () => {
  const parsed = parseWorkoutCsv(HEVY_CSV);

  it('rebuilds the sessions in chronological order', () => {
    assert.equal(parsed.source, 'hevy');
    assert.equal(parsed.workouts.length, 2);
    assert.deepEqual(
      parsed.workouts.map((workout) => workout.name),
      ['upper 1', 'legs'],
    );
  });

  it('nests exercises and sets under the right session', () => {
    const legs = parsed.workouts[1]!;

    assert.equal(legs.startedAt, local(2025, 5, 21, 20, 44));
    assert.equal(legs.finishedAt, local(2025, 5, 21, 22, 3));
    assert.equal(legs.durationSeconds, 79 * 60);
    assert.equal(legs.notes, 'felt strong');
    assert.deepEqual(
      legs.exercises.map((exercise) => exercise.name),
      ['Seated Leg Curl (Machine)', 'Leg Extension (Machine)'],
    );
    assert.deepEqual(legs.exercises[0]!.sets, [
      { setType: 'warmup', weightKg: 52, reps: 5, durationSeconds: null, distanceKm: null, rpe: null },
      { setType: 'normal', weightKg: 60, reps: 5, durationSeconds: null, distanceKm: null, rpe: null },
    ]);
  });

  it('keeps the per-exercise notes and RPE', () => {
    const extension = parsed.workouts[1]!.exercises[1]!;

    assert.equal(extension.notes, 'slow negatives');
    assert.equal(extension.sets[0]!.rpe, 8);
    assert.equal(extension.sets[1]!.setType, 'failure');
  });

  it('counts what it read', () => {
    assert.equal(parsed.diagnostics.totalRows, 6);
    assert.equal(parsed.diagnostics.undatedRows, 0);
    assert.equal(parsed.diagnostics.blankRows, 0);
    assert.equal(parsed.diagnostics.weightUnitSource, 'header');
    assert.equal(countSets(parsed.workouts), 6);
  });
});

describe('parseWorkoutCsv: Lift', () => {
  const parsed = parseWorkoutCsv(LIFT_CSV);

  it("reads the app's own export", () => {
    assert.equal(parsed.source, 'lift');
    assert.equal(parsed.workouts.length, 1);

    const workout = parsed.workouts[0]!;
    assert.equal(workout.name, 'Push day');
    assert.equal(workout.startedAt, Date.UTC(2026, 7, 18, 17, 30));
    assert.deepEqual(
      workout.exercises.map((exercise) => exercise.name),
      ['Bench Press (Barbell)', 'Plank'],
    );
  });

  it('reads a duration-only set without inventing a weight', () => {
    const plank = parsed.workouts[0]!.exercises[1]!.sets[0]!;

    assert.equal(plank.durationSeconds, 90);
    assert.equal(plank.weightKg, null);
    assert.equal(plank.reps, null);
  });

  it('leaves an unknown session length null rather than zero', () => {
    const workout = parsed.workouts[0]!;

    assert.equal(workout.durationSeconds, null);
    // Never null: a null finish is what marks the *active* session, and an
    // import must not reopen a workout from two years ago.
    assert.equal(workout.finishedAt, workout.startedAt);
  });
});

describe('parseWorkoutCsv: units', () => {
  it('converts a pounds column to kilograms', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight (lbs),Reps\n2025-05-21,Squat,225,5',
    );

    assert.equal(parsed.diagnostics.weightUnit, 'lb');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.0583);
  });

  it('lets the header override what the user picked', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,weight_kg,Reps\n2025-05-21,Squat,100,5', {
      weightUnit: 'lb',
    });

    assert.equal(parsed.diagnostics.weightUnitSource, 'header');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 100);
  });

  it('uses the chosen unit when the file names none', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,Weight,Reps\n2025-05-21,Squat,225,5', {
      weightUnit: 'lb',
    });

    assert.equal(parsed.diagnostics.weightUnitSource, 'chosen');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.0583);
  });

  it('reads a per-row unit column', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Unit,Reps\n2025-05-21,Squat,100,kg,5\n2025-05-21,Bench,225,lbs,5',
    );

    assert.equal(parsed.diagnostics.weightUnitSource, 'column');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 100);
    assert.equal(parsed.workouts[0]!.exercises[1]!.sets[0]!.weightKg, 102.0583);
  });

  it('converts miles to kilometres', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Distance (mi),Duration\n2025-05-21,Running,3,1800',
    );

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.distanceKm, 4.82803);
  });
});

describe('parseWorkoutCsv: European exports', () => {
  it('refuses translated headers in a sentence rather than importing nothing', () => {
    // The aliases are English, which is why the import screen says to switch
    // the source app's language before exporting. What matters is that the
    // refusal names the missing column instead of producing an empty import
    // the user would read as "my file was fine and Lift lost it".
    assert.throws(
      () => parseWorkoutCsv('Datum;Übung;Gewicht (kg);Wiederholungen\n21.05.2025;Kniebeuge;102,5;5'),
      (error: Error) =>
        error instanceof ImportFormatError && /exercise column/i.test(error.message),
    );
  });

  it('reads comma decimals when the headers are recognisable', () => {
    const parsed = parseWorkoutCsv(
      'Date;Exercise;Weight;Reps\n21.05.2025;Squat;102,5;5',
    );

    assert.equal(parsed.workouts[0]!.startedAt, local(2025, 5, 21));
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.5);
  });
});

describe('parseWorkoutCsv: effort', () => {
  it('reads reps-in-reserve as the RPE it means', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,Weight,Reps,RIR\n2025-05-21,Squat,100,5,2');

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.rpe, 8);
  });

  it('prefers an RPE column when the file has both', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps,RPE,RIR\n2025-05-21,Squat,100,5,9.5,2',
    );

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.rpe, 9.5);
  });
});

describe('parseWorkoutCsv: supersets', () => {
  const csv = [
    'start_time,title,exercise_title,superset_id,weight_kg,reps',
    '2025-05-21 10:00,Pull,Row,1,80,8',
    '2025-05-21 10:00,Pull,Curl,1,20,10',
    '2025-05-21 10:00,Pull,Shrug,2,100,12',
  ].join('\n');

  it('numbers groups shared by two or more exercises', () => {
    const [workout] = parseWorkoutCsv(csv).workouts;

    assert.equal(workout!.exercises[0]!.supersetGroup, 0);
    assert.equal(workout!.exercises[1]!.supersetGroup, 0);
  });

  it('leaves a group of one alone', () => {
    const [workout] = parseWorkoutCsv(csv).workouts;
    assert.equal(workout!.exercises[2]!.supersetGroup, null);
  });
});

describe('parseWorkoutCsv: rows it cannot use', () => {
  it('skips undated rows and says how many', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps\n2025-05-21,Squat,100,5\nsometime,Squat,100,5',
    );

    assert.equal(parsed.diagnostics.undatedRows, 1);
    assert.equal(countSets(parsed.workouts), 1);
  });

  it('skips rows that record nothing performed', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps\n2025-05-21,Squat,100,5\n2025-05-21,Squat,,',
    );

    assert.equal(parsed.diagnostics.blankRows, 1);
    assert.equal(countSets(parsed.workouts), 1);
  });

  it('tallies set types it had to flatten', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Set Type,Weight,Reps\n2025-05-21,Squat,amrap,100,15',
    );

    assert.deepEqual(parsed.diagnostics.coercedSetTypes, { amrap: 1 });
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.setType, 'normal');
  });

  it('refuses a file with no exercise column, by name', () => {
    assert.throws(
      () => parseWorkoutCsv('Date,Weight,Reps\n2025-05-21,100,5'),
      (error: Error) =>
        error instanceof ImportFormatError && /exercise column/i.test(error.message),
    );
  });

  it('refuses a file with no date column, by name', () => {
    assert.throws(
      () => parseWorkoutCsv('Exercise,Weight,Reps\nSquat,100,5'),
      (error: Error) => error instanceof ImportFormatError && /date column/i.test(error.message),
    );
  });

  it('refuses an empty file', () => {
    assert.throws(() => parseWorkoutCsv(''), ImportFormatError);
  });
});

describe('parseWorkoutCsv: ordering', () => {
  it('puts sets back in index order when a spreadsheet has been re-sorted', () => {
    const parsed = parseWorkoutCsv(
      [
        'start_time,exercise_title,set_index,set_type,weight_kg,reps',
        '2025-05-21 10:00,Squat,1,normal,100,5',
        '2025-05-21 10:00,Squat,0,warmup,60,5',
      ].join('\n'),
    );

    assert.deepEqual(
      parsed.workouts[0]!.exercises[0]!.sets.map((set) => set.setType),
      ['warmup', 'normal'],
    );
  });

  it('gathers an exercise returned to later in the session', () => {
    const parsed = parseWorkoutCsv(
      [
        'start_time,exercise_title,weight_kg,reps',
        '2025-05-21 10:00,Squat,100,5',
        '2025-05-21 10:00,Bench,80,5',
        '2025-05-21 10:00,Squat,110,3',
      ].join('\n'),
    );

    const [squat, bench] = parsed.workouts[0]!.exercises;
    assert.equal(squat!.sets.length, 2);
    assert.equal(bench!.sets.length, 1);
  });
});

// ---------------------------------------------------------------------------
// How far back
// ---------------------------------------------------------------------------

describe('importCutoff', () => {
  const now = new Date(2026, 7, 20, 14, 0);

  it('counts calendar days including today', () => {
    assert.equal(importCutoff('7d', now), local(2026, 8, 14));
    assert.equal(importCutoff('30d', now), local(2026, 7, 22));
  });

  it('has no cutoff for everything', () => {
    assert.equal(importCutoff('all', now), null);
  });

  it('keeps a session logged earlier today', () => {
    const cutoff = importCutoff('7d', now)!;
    assert.ok(local(2026, 8, 20, 6, 30) >= cutoff);
  });
});

describe('filterWorkoutsSince', () => {
  const workouts = [
    { startedAt: local(2026, 1, 1), exercises: [] },
    { startedAt: local(2026, 8, 19), exercises: [] },
  ] as never as Parameters<typeof filterWorkoutsSince>[0];

  it('drops everything before the cutoff', () => {
    const kept = filterWorkoutsSince(workouts, local(2026, 8, 14));
    assert.equal(kept.length, 1);
  });

  it('keeps everything when there is no cutoff', () => {
    assert.equal(filterWorkoutsSince(workouts, null).length, 2);
  });
});

describe('importing only a recent slice', () => {
  // Four sessions spread across a year, written the way Hevy writes them.
  const csv = [
    'title,start_time,exercise_title,set_index,set_type,weight_kg,reps',
    'legs,15 Aug 2026 10:00,Squat,0,normal,140,5',
    'push,10 Aug 2026 10:00,Bench Press,0,normal,100,5',
    'pull,01 Jul 2026 10:00,Deadlift,0,normal,180,3',
    'legs,03 Feb 2026 10:00,Squat,0,normal,120,5',
  ].join('\n');

  const parsed = parseWorkoutCsv(csv);
  const now = new Date(2026, 7, 16, 9, 0);

  it('keeps only the sessions inside the window', () => {
    const kept = filterWorkoutsSince(parsed.workouts, importCutoff('7d', now));

    assert.deepEqual(
      kept.map((workout) => workout.name),
      ['push', 'legs'],
    );
    assert.equal(countSets(kept), 2);
  });

  it('widens with the window', () => {
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('30d', now)).length, 2);
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('3m', now)).length, 3);
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('all', now)).length, 4);
  });

  it('narrows the exercises the import would need along with the dates', () => {
    const week = filterWorkoutsSince(parsed.workouts, importCutoff('7d', now));

    // Deadlift is only in the July session, so importing last week must not
    // drag it into the library.
    assert.deepEqual(collectExerciseNames(week).sort(), ['Bench Press', 'Squat']);
  });
});

describe('collectExerciseNames', () => {
  it('lists each name once, in the order it first appears', () => {
    const parsed = parseWorkoutCsv(HEVY_CSV);

    assert.deepEqual(collectExerciseNames(parsed.workouts), [
      'Incline Bench Press (Dumbbell)',
      'Lat Pulldown (Cable)',
      'Seated Leg Curl (Machine)',
      'Leg Extension (Machine)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

describe('exerciseMatchKey', () => {
  it('collapses word order, punctuation and plurals', () => {
    assert.equal(exerciseMatchKey('Bench Press (Barbell)'), exerciseMatchKey('Barbell Bench Press'));
    assert.equal(exerciseMatchKey('Bent-Over Row'), exerciseMatchKey('Bent Over Row'));
    assert.equal(exerciseMatchKey('Push Ups'), exerciseMatchKey('Push Up'));
  });

  it('keeps genuinely different lifts apart', () => {
    assert.notEqual(exerciseMatchKey('Front Squat'), exerciseMatchKey('Back Squat'));
    assert.notEqual(exerciseMatchKey('Bench Press (Barbell)'), exerciseMatchKey('Bench Press (Dumbbell)'));
  });

  it('leaves double-s words alone', () => {
    assert.equal(exerciseMatchKey('Press'), 'press');
    assert.equal(exerciseMatchKey('Cable Cross'), 'cable cross');
  });
});

describe('inferEquipment', () => {
  it('reads the parenthetical every app appends', () => {
    assert.equal(inferEquipment('Bench Press (Barbell)'), 'barbell');
    assert.equal(inferEquipment('Lat Pulldown (Cable)'), 'cable');
    assert.equal(inferEquipment('Row (Smith Machine)'), 'smith_machine');
    assert.equal(inferEquipment('Pull Up'), 'other');
  });

  it('prefers the longer match', () => {
    assert.equal(inferEquipment('Smith Machine Row'), 'smith_machine');
  });
});

describe('inferTrackingType', () => {
  const set = (values: Partial<Parameters<typeof inferTrackingType>[1][number]>) => ({
    setType: 'normal' as const,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceKm: null,
    rpe: null,
    ...values,
  });

  it('reads a loaded rep exercise', () => {
    assert.equal(inferTrackingType('Squat', [set({ weightKg: 100, reps: 5 })]), 'weight_reps');
  });

  it('reads a weight column of zeroes as bodyweight', () => {
    assert.equal(inferTrackingType('Push Up', [set({ weightKg: 0, reps: 20 })]), 'bodyweight_reps');
  });

  it('claims no volume when there is no weight column at all', () => {
    assert.equal(inferTrackingType('Push Up', [set({ reps: 20 })]), 'reps_only');
  });

  it('reads holds and runs', () => {
    assert.equal(inferTrackingType('Plank', [set({ durationSeconds: 90 })]), 'duration');
    assert.equal(
      inferTrackingType('Running', [set({ distanceKm: 5, durationSeconds: 1800 })]),
      'distance_duration',
    );
  });

  it('takes the name at its word on assisted and weighted variants', () => {
    assert.equal(
      inferTrackingType('Pull Up (Assisted)', [set({ weightKg: 20, reps: 8 })]),
      'assisted_bodyweight',
    );
    assert.equal(
      inferTrackingType('Chin Up (Weighted)', [set({ weightKg: 20, reps: 8 })]),
      'weighted_bodyweight',
    );
  });
});
