import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextPosition, positionBetween, renumber, reorder, type PositionedRow } from './ordering.ts';

/** Four rows at whole positions, the shape a freshly seeded list has. */
function rows(...positions: number[]): PositionedRow[] {
  return positions.map((position, index) => ({ id: `id${index}`, position }));
}

/** Applies a reorder's writes and returns the ids in their resulting order. */
function apply(list: PositionedRow[], writes: PositionedRow[]): string[] {
  const byId = new Map(writes.map((write) => [write.id, write.position]));
  return [...list]
    .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
    .sort((a, b) => a.position - b.position)
    .map((row) => row.id);
}

test('a move writes exactly one row', () => {
  const list = rows(1, 2, 3, 4);
  const writes = reorder(list, 0, 2);

  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.id, 'id0');
  assert.deepEqual(apply(list, writes), ['id1', 'id2', 'id0', 'id3']);
});

test('moves in both directions land where asked', () => {
  const list = rows(1, 2, 3, 4);

  assert.deepEqual(apply(list, reorder(list, 3, 0)), ['id3', 'id0', 'id1', 'id2']);
  assert.deepEqual(apply(list, reorder(list, 3, 1)), ['id0', 'id3', 'id1', 'id2']);
  assert.deepEqual(apply(list, reorder(list, 1, 3)), ['id0', 'id2', 'id3', 'id1']);
  assert.deepEqual(apply(list, reorder(list, 2, 0)), ['id2', 'id0', 'id1', 'id3']);
});

test('every source-to-target pair produces the order a splice would', () => {
  const list = rows(1, 2, 3, 4, 5);

  for (let from = 0; from < list.length; from++) {
    for (let to = 0; to < list.length; to++) {
      const expected = list.map((row) => row.id);
      const [moved] = expected.splice(from, 1);
      expected.splice(to, 0, moved!);

      assert.deepEqual(
        apply(list, reorder(list, from, to)),
        expected,
        `moving ${from} to ${to}`,
      );
    }
  }
});

test('a move to its own index writes nothing', () => {
  assert.deepEqual(reorder(rows(1, 2, 3), 1, 1), []);
});

test('a list too short to reorder writes nothing', () => {
  assert.deepEqual(reorder(rows(1), 0, 0), []);
  assert.deepEqual(reorder([], 0, 0), []);
});

test('out-of-range indices clamp rather than throw', () => {
  const list = rows(1, 2, 3);

  assert.deepEqual(apply(list, reorder(list, 0, 99)), ['id1', 'id2', 'id0']);
  assert.deepEqual(apply(list, reorder(list, -5, 2)), ['id1', 'id2', 'id0']);
  assert.deepEqual(reorder(list, 99, 99), []);
});

test('repeated drops into the same gap keep the order intact', () => {
  // The pathological case the fractional scheme is judged on: always drop the
  // last row one place up, into a gap that halves every time.
  let list = rows(1, 2, 3, 4);

  for (let round = 0; round < 200; round++) {
    const writes = reorder(list, 3, 2);
    const byId = new Map(writes.map((write) => [write.id, write.position]));
    list = list
      .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
      .sort((a, b) => a.position - b.position);

    // Positions stay strictly increasing, which is the only property the rest
    // of the app relies on.
    for (let index = 1; index < list.length; index++) {
      assert.ok(
        list[index]!.position > list[index - 1]!.position,
        `round ${round}: position ${index} did not exceed its predecessor`,
      );
    }
  }
});

test('an exhausted gap renumbers the whole list instead of colliding', () => {
  // Two rows a hair apart, with a third to drop between them.
  const list: PositionedRow[] = [
    { id: 'a', position: 1 },
    { id: 'b', position: 1 + 1e-12 },
    { id: 'c', position: 5 },
  ];

  const writes = reorder(list, 2, 1);

  assert.equal(writes.length, 3, 'expected a full renumber');
  assert.deepEqual(apply(list, writes), ['a', 'c', 'b']);
  assert.deepEqual(
    writes.map((write) => write.position),
    [1, 2, 3],
  );
});

test('positionBetween handles both open ends', () => {
  assert.equal(positionBetween(null, null), 1);
  assert.equal(positionBetween(null, 5), 4);
  assert.equal(positionBetween(3, null), 4);
  assert.equal(positionBetween(2, 4), 3);
  assert.equal(positionBetween(1, 1 + 1e-12), null);
});

test('renumber spaces rows from one', () => {
  assert.deepEqual(renumber(rows(0.5, 0.75, 9)), [
    { id: 'id0', position: 1 },
    { id: 'id1', position: 2 },
    { id: 'id2', position: 3 },
  ]);
});

test('nextPosition follows the largest position, not the count', () => {
  assert.equal(nextPosition([]), 1);
  assert.equal(nextPosition(rows(1, 2, 3)), 4);
  // A list whose rows were dropped between each other still appends past the end.
  assert.equal(nextPosition(rows(1, 1.5, 1.75)), 2.75);
});
