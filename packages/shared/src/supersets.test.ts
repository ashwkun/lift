import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyAssignments,
  inSameSuperset,
  joinSuperset,
  leaveSuperset,
  normalizeSupersets,
  runLabel,
  supersetPlacements,
  supersetRuns,
  type SupersetRow,
} from './supersets.ts';

/**
 * A list written the way it reads on screen: one letter per exercise, a digit
 * for the superset it belongs to. `rows('a1', 'b1', 'c')` is a pair followed by
 * a lone lift.
 */
function rows(...spec: string[]): SupersetRow[] {
  return spec.map((entry) => ({
    id: entry[0]!,
    supersetGroup: entry.length > 1 ? Number(entry.slice(1)) : null,
  }));
}

/** The same notation back out, so an assertion reads like the input. */
function spec(list: readonly SupersetRow[]): string[] {
  return list.map((row) => `${row.id}${row.supersetGroup ?? ''}`);
}

/** What storage holds after a set of writes is applied. */
function after(list: readonly SupersetRow[], writes: Parameters<typeof applyAssignments>[1]) {
  return spec(applyAssignments(list, writes));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('a run needs two adjacent rows sharing an id', () => {
  assert.deepEqual(supersetRuns(rows('a1', 'b1', 'c')).map((run) => run.memberIds), [['a', 'b']]);

  // One member is not a superset, and neither is a pair with a lift between it.
  assert.deepEqual(supersetRuns(rows('a1', 'b', 'c')), []);
  assert.deepEqual(supersetRuns(rows('a1', 'b', 'c1')), []);
});

test('labels come from the list, not from the stored id', () => {
  const runs = supersetRuns(rows('a7', 'b7', 'c', 'd2', 'e2'));

  assert.deepEqual(
    runs.map((run) => [run.label, run.group]),
    [
      ['A', 7],
      ['B', 2],
    ],
  );
});

test('runLabel prints letters, then numbers past Z', () => {
  assert.equal(runLabel(0), 'A');
  assert.equal(runLabel(25), 'Z');
  assert.equal(runLabel(26), '27');
});

test('placements say where in the run each exercise sits', () => {
  const placements = supersetPlacements(rows('a1', 'b1', 'c1', 'd'));

  assert.deepEqual(placements.get('a'), {
    group: 1,
    label: 'A',
    index: 1,
    size: 3,
    first: true,
    last: false,
  });
  assert.equal(placements.get('c')?.last, true);
  assert.equal(placements.get('d'), undefined);
});

test('unattached rows side by side are not a group of nulls', () => {
  assert.deepEqual(supersetRuns(rows('a', 'b', 'c')), []);
  assert.equal(inSameSuperset(rows('a', 'b'), 'a', 'b'), false);
  assert.equal(inSameSuperset(rows('a1', 'b1'), 'a', 'b'), true);
});

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

test('pairing two unattached lifts writes both and nothing else', () => {
  const list = rows('a', 'b', 'c');
  const writes = joinSuperset(list, 'a', 'down');

  assert.equal(writes.length, 2);
  assert.deepEqual(after(list, writes), ['a1', 'b1', 'c']);
});

test('joining an existing superset writes only the row that joined', () => {
  const list = rows('a3', 'b3', 'c');
  const writes = joinSuperset(list, 'c', 'up');

  assert.deepEqual(writes, [{ id: 'c', supersetGroup: 3 }]);
  assert.deepEqual(after(list, writes), ['a3', 'b3', 'c3']);
});

test('the row that already has a group keeps its id when it extends downwards', () => {
  const list = rows('a3', 'b3', 'c');

  assert.deepEqual(after(list, joinSuperset(list, 'b', 'down')), ['a3', 'b3', 'c3']);
});

test('joining two supersets end to end merges them into one', () => {
  const list = rows('a1', 'b1', 'c2', 'd2');
  const writes = joinSuperset(list, 'b', 'down');

  assert.deepEqual(after(list, writes), ['a1', 'b1', 'c1', 'd1']);
  assert.deepEqual(supersetRuns(applyAssignments(list, writes)).length, 1);
});

test('joining rows that are already together writes nothing', () => {
  const list = rows('a1', 'b1');

  assert.deepEqual(joinSuperset(list, 'a', 'down'), []);
  assert.deepEqual(joinSuperset(list, 'b', 'up'), []);
});

test('there is no neighbour past either end', () => {
  const list = rows('a', 'b');

  assert.deepEqual(joinSuperset(list, 'a', 'up'), []);
  assert.deepEqual(joinSuperset(list, 'b', 'down'), []);
  assert.deepEqual(joinSuperset(list, 'missing', 'down'), []);
});

test('a fresh id steps past every group already in the list', () => {
  const list = rows('a4', 'b4', 'c', 'd');

  assert.deepEqual(after(list, joinSuperset(list, 'c', 'down')), ['a4', 'b4', 'c5', 'd5']);
});

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

test('leaving a pair clears both, because one is not a superset', () => {
  const list = rows('a1', 'b1', 'c');

  assert.deepEqual(after(list, leaveSuperset(list, 'a')), ['a', 'b', 'c']);
});

test('leaving a three-way superset from either end leaves the other two', () => {
  const list = rows('a1', 'b1', 'c1');

  assert.deepEqual(after(list, leaveSuperset(list, 'a')), ['a', 'b1', 'c1']);
  assert.deepEqual(after(list, leaveSuperset(list, 'c')), ['a1', 'b1', 'c']);
});

test('leaving from the middle clears the whole superset', () => {
  // a and c are no longer performed back to back: b is standing between them.
  const list = rows('a1', 'b1', 'c1');

  assert.deepEqual(after(list, leaveSuperset(list, 'b')), ['a', 'b', 'c']);
});

test('leaving a superset that is not there writes nothing', () => {
  const list = rows('a', 'b1', 'c1');

  assert.deepEqual(leaveSuperset(list, 'a'), []);
  assert.deepEqual(leaveSuperset(list, 'missing'), []);
});

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

test('an intact list needs no writes', () => {
  assert.deepEqual(normalizeSupersets(rows('a1', 'b1', 'c', 'd2', 'e2')), []);
  assert.deepEqual(normalizeSupersets(rows()), []);
});

test('a member left alone is cleared', () => {
  // What deleting b out of a pair leaves behind.
  const list = rows('a1', 'c');

  assert.deepEqual(after(list, normalizeSupersets(list)), ['a', 'c']);
});

test('a drag through the middle of a pair breaks it', () => {
  const list = rows('a1', 'c', 'b1');

  assert.deepEqual(after(list, normalizeSupersets(list)), ['a', 'c', 'b']);
});

test('a split that leaves two real halves renames the second', () => {
  // a,b and c,d all carry 1: one id naming two stretches, which is a reorder
  // having moved half of a four-way superset past something else.
  const list = rows('a1', 'b1', 'x', 'c1', 'd1');
  const writes = normalizeSupersets(list);

  assert.deepEqual(after(list, writes), ['a1', 'b1', 'x', 'c2', 'd2']);
  // The half that did not move is not rewritten.
  assert.deepEqual(
    writes.map((write) => write.id),
    ['c', 'd'],
  );
});

test('a renamed half steps past every id in use', () => {
  const list = rows('a1', 'b1', 'x', 'c1', 'd1', 'y', 'e2', 'f2');

  assert.deepEqual(after(list, normalizeSupersets(list)), [
    'a1',
    'b1',
    'x',
    'c3',
    'd3',
    'y',
    'e2',
    'f2',
  ]);
});

test('normalising is idempotent', () => {
  const list = rows('a1', 'b', 'c1', 'd2', 'e2', 'f2', 'g1');
  const once = applyAssignments(list, normalizeSupersets(list));

  assert.deepEqual(normalizeSupersets(once), []);
});

test('every run normalising leaves behind is a real superset', () => {
  // Reordering is the mutation this module does not control, so the invariant
  // has to survive an arbitrary one. Every permutation of a list holding two
  // supersets and a spare lift, normalised, must hold only runs of two or more
  // with no id in two places.
  const base = rows('a1', 'b1', 'c2', 'd2', 'e');

  for (const order of permutations([0, 1, 2, 3, 4])) {
    const shuffled = order.map((index) => base[index]!);
    const settled = applyAssignments(shuffled, normalizeSupersets(shuffled));

    const seen = new Set<number>();
    let members = 0;

    for (const run of supersetRuns(settled)) {
      assert.ok(run.memberIds.length >= 2, `run of ${run.memberIds.length} in ${spec(settled)}`);
      assert.ok(!seen.has(run.group), `id ${run.group} twice in ${spec(settled)}`);
      seen.add(run.group);
      members += run.memberIds.length;
    }

    // Nothing keeps a group id without being in a run that displays it.
    assert.equal(
      settled.filter((row) => row.supersetGroup !== null).length,
      members,
      `orphan id in ${spec(settled)}`,
    );
  }
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];

  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}
