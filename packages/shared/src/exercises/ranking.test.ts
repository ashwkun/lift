import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MuscleGroup } from '../types.ts';
import {
  buildTrainingIndex,
  filterExercises,
  suggestExercises,
  type FilterableExercise,
  type RankableExercise,
  type TrainingHistoryRow,
} from './ranking.ts';

const NOW = Date.UTC(2026, 0, 15);
const DAY = 86_400_000;

function exercise(
  id: string,
  primaryMuscle: MuscleGroup,
  secondaryMuscles: MuscleGroup[] = [],
  isArchived = false,
): RankableExercise {
  return { id, name: id, primaryMuscle, secondaryMuscles, isArchived };
}

/** `[workoutId, exerciseId, daysAgo]`, which is how the fixtures below read. */
function history(rows: [string, string, number][]): TrainingHistoryRow[] {
  return rows.map(([workoutId, exerciseId, daysAgo]) => ({
    workoutId,
    exerciseId,
    startedAt: new Date(NOW - daysAgo * DAY),
  }));
}

const CATALOG: RankableExercise[] = [
  exercise('bench', 'chest', ['triceps']),
  exercise('flyes', 'chest'),
  exercise('dips', 'triceps', ['chest']),
  exercise('row', 'lats', ['biceps']),
  exercise('curl', 'biceps'),
  exercise('squat', 'quads', ['glutes']),
  exercise('leg-press', 'quads'),
  exercise('retired', 'chest', [], true),
];

describe('buildTrainingIndex', () => {
  it('counts sessions rather than rows', () => {
    // `bench` twice in w1: a superset, or a lift revisited at the end.
    const index = buildTrainingIndex(
      history([
        ['w1', 'bench', 3],
        ['w1', 'bench', 3],
        ['w2', 'bench', 10],
      ]),
    );

    assert.equal(index.usage.get('bench')?.uses, 2);
  });

  it('records the most recent session, whatever order the rows arrive in', () => {
    const index = buildTrainingIndex(
      history([
        ['w1', 'bench', 40],
        ['w2', 'bench', 2],
        ['w3', 'bench', 15],
      ]),
    );

    assert.equal(index.usage.get('bench')?.lastUsedAt, NOW - 2 * DAY);
  });

  it('has nothing to say about an empty log', () => {
    const index = buildTrainingIndex([]);
    assert.equal(index.usage.size, 0);
    assert.equal(index.sessionsByExercise.size, 0);
  });
});

describe('suggestExercises', () => {
  it('leads with what is trained alongside the current workout', () => {
    // Push days pair bench with flyes and dips; pull days pair row with curl.
    // `squat` is the single most-trained lift, so if frequency were leading
    // this it would come first regardless of what the session is.
    const index = buildTrainingIndex(
      history([
        ['p1', 'bench', 20],
        ['p1', 'flyes', 20],
        ['p1', 'dips', 20],
        ['p2', 'bench', 13],
        ['p2', 'flyes', 13],
        ['l1', 'row', 18],
        ['l1', 'curl', 18],
        ['s1', 'squat', 21],
        ['s2', 'squat', 14],
        ['s3', 'squat', 7],
        ['s4', 'squat', 4],
      ]),
    );

    const suggested = suggestExercises({
      catalog: CATALOG,
      index,
      context: ['bench'],
      now: NOW,
    });

    const ids = suggested.map((row) => row.id);

    assert.deepEqual(ids.slice(0, 2), ['flyes', 'dips']);
    assert.ok(!ids.includes('bench'), 'excludes what is already added');
  });

  it('falls back to frequency and recency with no session context', () => {
    const index = buildTrainingIndex(
      history([
        ['s1', 'squat', 21],
        ['s2', 'squat', 14],
        ['s3', 'squat', 7],
        ['p1', 'bench', 60],
        ['p2', 'bench', 55],
        ['l1', 'row', 200],
      ]),
    );

    const suggested = suggestExercises({ catalog: CATALOG, index, now: NOW });

    assert.deepEqual(
      suggested.map((row) => row.id),
      ['squat', 'bench', 'row'],
    );
  });

  it('suggests by muscle overlap on day one, before there is any history', () => {
    const suggested = suggestExercises({
      catalog: CATALOG,
      index: buildTrainingIndex([]),
      context: ['bench'],
      now: NOW,
    });

    // Chest and triceps work, ranked above everything the session doesn't touch,
    // and there is nothing else in the list, because a zero score is dropped.
    assert.deepEqual(
      suggested.map((row) => row.id),
      ['dips', 'flyes'],
    );
  });

  it('never offers an archived exercise', () => {
    const index = buildTrainingIndex(history([['w1', 'retired', 2]]));

    const suggested = suggestExercises({
      catalog: CATALOG,
      index,
      context: ['bench'],
      now: NOW,
    });

    assert.ok(suggested.every((row) => row.id !== 'retired'));
  });

  it('ranks a lift trained last week over one last touched a year ago', () => {
    const index = buildTrainingIndex(
      history([
        ['w1', 'flyes', 5],
        ['w2', 'dips', 300],
      ]),
    );

    const suggested = suggestExercises({ catalog: CATALOG, index, now: NOW });

    assert.deepEqual(
      suggested.map((row) => row.id),
      ['flyes', 'dips'],
    );
  });

  it('holds the limit', () => {
    const index = buildTrainingIndex(
      history(CATALOG.map((row, i) => ['w' + i, row.id, i + 1] as [string, string, number])),
    );

    assert.equal(suggestExercises({ catalog: CATALOG, index, limit: 3, now: NOW }).length, 3);
  });
});

// ---------------------------------------------------------------------------
// Search ordering
// ---------------------------------------------------------------------------

/**
 * Names rather than ids, because ordering search results is entirely a question
 * about names. Shaped like the real catalog: a movement, its equipment, and the
 * long tail of oddities that share the word.
 */
function named(name: string): FilterableExercise {
  return {
    id: name,
    name,
    primaryMuscle: 'chest',
    secondaryMuscles: [],
    isArchived: false,
    isCustom: false,
    equipment: 'other',
  };
}

const SEARCHABLE: FilterableExercise[] = [
  named('Squat'),
  named('Dumbbell Squat'),
  named('Barbell Squat'),
  named('U Squat'),
  named('Sit Squat'),
  named('Dumbbell Press Squat'),
  named('Bench Press'),
  named('Dumbbell Bench Press'),
  named('Squat Press-up'),
  named('Barbell Row'),
  named('Dumbbell Row'),
  named('Rowing'),
  named('Rowing Boat Yoga Pose'),
  // Enough dumbbells and barbells that they read as the catalog's common words.
  named('Dumbbell Curl'),
  named('Dumbbell Fly'),
  named('Barbell Curl'),
  named('Barbell Fly'),
];

const order = (search: string) => filterExercises(SEARCHABLE, { search }).map((row) => row.name);

describe('filterExercises ordering', () => {
  it('puts the exact name first', () => {
    assert.equal(order('squat')[0], 'Squat');
  });

  /*
   * The regression the whole-word tier exists for: "row" used to answer with
   * Rowing and Rowing Boat Yoga Pose before any actual row.
   */
  it('ranks a name containing the word above one merely starting with it', () => {
    const rows = order('row');
    assert.ok(rows.indexOf('Barbell Row') < rows.indexOf('Rowing'));
    assert.ok(rows.indexOf('Dumbbell Row') < rows.indexOf('Rowing Boat Yoga Pose'));
  });

  /*
   * Within a tier, what the name adds to the query decides. Fewer added words
   * first: "Bench Press" is a variant of "press", "Dumbbell Press Squat" is a
   * different exercise that contains it.
   */
  it('prefers the name that adds least to the query', () => {
    const rows = order('press');
    assert.ok(rows.indexOf('Bench Press') < rows.indexOf('Dumbbell Press Squat'));
    assert.ok(rows.indexOf('Bench Press') < rows.indexOf('Squat Press-up'));
  });

  /*
   * And among names that added equally little, the one built from the
   * catalog's common words. Without this "squat" opens on U Squat and Sit
   * Squat, which is the alphabet pretending to be relevance.
   */
  it('prefers the mainstream variant among equally short additions', () => {
    const rows = order('squat');
    assert.ok(rows.indexOf('Dumbbell Squat') < rows.indexOf('U Squat'));
    assert.ok(rows.indexOf('Barbell Squat') < rows.indexOf('Sit Squat'));
  });

  it('never lets ordering drop a match', () => {
    // Squat, Dumbbell/Barbell/U/Sit Squat, Dumbbell Press Squat, Squat Press-up.
    assert.equal(order('squat').length, 7);
    assert.equal(order('nothing here').length, 0);
  });

  // The frequency index is memoised on the row array's identity, so the second
  // search over the same array must not see a stale or doubled index.
  it('gives the same answer twice over the same rows', () => {
    assert.deepEqual(order('squat'), order('squat'));
  });
});
