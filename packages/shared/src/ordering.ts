/**
 * Where a dragged row lands, as a number.
 *
 * `position` is a REAL rather than an INTEGER precisely so a move can usually
 * be one write: dropping a row between 1.0 and 2.0 writes 1.5 and leaves every
 * other row alone (see the schema notes in `apps/mobile/src/db/schema.ts`). That
 * matters more here than it would in a local-only app — each rewritten row is
 * also an oplog entry and a row on the wire, so renumbering a ten-exercise
 * workout to move one block would sync ten changes to say one thing.
 *
 * Halving a gap forever is not free, though, and this module is where that ends:
 * doubles run out of room after about fifty consecutive midpoints, and a
 * position that collides with its neighbour silently stops being an order at
 * all. So the midpoint is taken while there is room, and the list renumbers when
 * there is not — which is rare, and correct when it happens.
 */

export interface PositionedRow {
  id: string;
  position: number;
}

/**
 * The smallest gap a midpoint may be taken from.
 *
 * Doubles hold far finer differences than this, but "representable" is the
 * wrong bar: positions round-trip through SQLite, JSON and the sync API, and a
 * gap of 1e-9 survives all three while leaving no room for the *next* drop
 * between the same pair. Renumbering at a gap this wide costs one full rewrite
 * roughly never, and buys a list that cannot degrade.
 */
const MIN_GAP = 1e-6;

/** Spacing used when the list is renumbered, and for a row appended to the end. */
export const POSITION_STEP = 1;

/**
 * Moves the row at `from` to index `to`, and returns **only the rows whose
 * position changed** — usually one, occasionally all of them.
 *
 * The caller writes exactly what comes back. An empty array means the move was
 * a no-op and nothing should be written, which is the common case for a drag
 * that ends where it started.
 *
 * `rows` must already be in position order; the indices are into that order,
 * not into storage.
 */
export function reorder(
  rows: readonly PositionedRow[],
  from: number,
  to: number,
): PositionedRow[] {
  if (rows.length < 2) return [];

  const start = clampIndex(from, rows.length);
  const end = clampIndex(to, rows.length);
  if (start === end) return [];

  const next = [...rows];
  const [moved] = next.splice(start, 1);
  if (!moved) return [];
  next.splice(end, 0, moved);

  const before = next[end - 1]?.position ?? null;
  const after = next[end + 1]?.position ?? null;
  const position = positionBetween(before, after);

  // `null` is this module's way of saying "there is no number left between
  // those two", which is the one case a single write cannot express.
  if (position === null) return renumber(next);

  return [{ id: moved.id, position }];
}

/**
 * A position strictly between two neighbours, or `null` when the gap is spent.
 *
 * Either side may be absent, which is what the ends of a list look like: a row
 * dropped at the top goes a step below whatever was there, and one dropped at
 * the bottom a step above. An empty list starts at `POSITION_STEP` rather than
 * at zero so there is always somewhere to insert *before* the first row.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return after! - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;

  // Out-of-order input would otherwise produce a midpoint outside the pair and
  // silently move the row somewhere nobody asked for. The caller is supposed to
  // hand these over sorted; if it did not, renumbering is the honest answer.
  if (after - before < MIN_GAP) return null;

  return before + (after - before) / 2;
}

/** Rewrites every position as 1, 2, 3… in the given order. */
export function renumber(rows: readonly PositionedRow[]): PositionedRow[] {
  return rows.map((row, index) => ({ id: row.id, position: (index + 1) * POSITION_STEP }));
}

/** The position for a row appended after everything already in the list. */
export function nextPosition(rows: readonly PositionedRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.position), 0) + POSITION_STEP;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}
