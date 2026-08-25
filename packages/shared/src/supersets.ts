/**
 * Which exercises are performed back to back, and what changing that costs.
 *
 * A superset is stored as a shared integer on the exercise rows themselves
 * (`workout_exercises.superset_group`, `routine_exercises.superset_group`)
 * rather than as a table of groups. There is no group to own: a superset has no
 * name, no order of its own and no life outside the list it sits in, so a
 * grouping table would be a row per superset whose only column is its identity.
 *
 * That leaves one invariant to defend, and it is the whole of this module:
 *
 * > **Every stored group id names exactly one contiguous run of at least two
 * > exercises.**
 *
 * Contiguous because that is what the word means. Two lifts alternated back to
 * back are next to each other in the session; a "superset" with a third
 * exercise sitting between its halves describes nothing anybody can perform. At
 * least two because a group of one is not a superset either, and a list that
 * can hold one will eventually be full of them: every removal, every reorder
 * and every substitution is a chance to leave a lone member behind.
 *
 * Neither the reorder sheet nor the exercise menu is going to maintain that by
 * hand, so nothing tries. `normalizeSupersets` is the only enforcement point
 * and every mutation here ends in it, including the ones callers make for
 * unrelated reasons: see the note on that function about reordering.
 *
 * Every function returns **only the rows whose group changed**, the same
 * contract `reorder()` keeps one module over, and for the same reason. Each
 * write is also an oplog entry and a row on the wire, so saying "these two are
 * a superset" should cost two rows rather than a rewrite of the session.
 */

/** The part of an exercise row this module reads. Order is the array's. */
export interface SupersetRow {
  id: string;
  supersetGroup: number | null;
}

/** A row whose group changed, and what to write. `null` clears it. */
export interface SupersetAssignment {
  id: string;
  supersetGroup: number | null;
}

/** A stretch of exercises performed back to back. */
export interface SupersetRun {
  /** The stored id its members share. */
  group: number;
  /** `A` for the first run in the list, `B` for the second. See `runLabel`. */
  label: string;
  /** Member ids, in list order. */
  memberIds: string[];
}

/** Where one exercise sits in the superset it belongs to. */
export interface SupersetPlacement {
  group: number;
  label: string;
  /** 1-based, so it can be printed: "2 of 3". */
  index: number;
  size: number;
  first: boolean;
  last: boolean;
}

/**
 * The letter a superset is known by on screen.
 *
 * Positional, not stored: the label comes from where the run sits in the list,
 * so the first superset in a session is always A. Storing a letter would mean
 * deciding what happens to B when A is dismantled, and the honest answer is
 * that nobody looking at a screen with one superset on it wants to see it
 * called B.
 *
 * Past twenty-six the number is printed instead. A session that deep is not a
 * workout, but a wrong letter is worse than an unfamiliar one.
 */
export function runLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/**
 * The maximal contiguous stretches of two or more rows sharing a group id.
 *
 * This is the *display* reading of the data, and it is deliberately more
 * forgiving than the invariant: a run of one, or a group id that shows up in
 * two places, is simply not returned rather than being an error. Storage is
 * kept honest by `normalizeSupersets`, but a screen mid-write should still draw
 * something sane, and "not a superset" is the sane thing to draw.
 */
export function supersetRuns(rows: readonly SupersetRow[]): SupersetRun[] {
  const runs: SupersetRun[] = [];

  for (const span of spans(rows)) {
    if (span.group === null || span.memberIds.length < 2) continue;
    runs.push({ group: span.group, label: runLabel(runs.length), memberIds: span.memberIds });
  }

  return runs;
}

/** Every row that is in a superset, keyed by id. Rows that are not are absent. */
export function supersetPlacements(
  rows: readonly SupersetRow[],
): Map<string, SupersetPlacement> {
  const placements = new Map<string, SupersetPlacement>();

  for (const run of supersetRuns(rows)) {
    run.memberIds.forEach((id, index) => {
      placements.set(id, {
        group: run.group,
        label: run.label,
        index: index + 1,
        size: run.memberIds.length,
        first: index === 0,
        last: index === run.memberIds.length - 1,
      });
    });
  }

  return placements;
}

/** Whether these two ids are performed back to back. */
export function inSameSuperset(rows: readonly SupersetRow[], a: string, b: string): boolean {
  const placements = supersetPlacements(rows);
  const left = placements.get(a);
  return left !== undefined && left.group === placements.get(b)?.group;
}

/**
 * Pairs `id` with the exercise directly above or below it.
 *
 * The neighbour is positional rather than named by the caller, because that is
 * the only pairing a superset can express: what is being asked for is "these
 * two, back to back", and the two have to be adjacent for the answer to mean
 * anything. A caller wanting to superset with something further down the list
 * is really asking to move it first.
 *
 * Both sides bring their existing supersets with them. Joining a lift to one
 * half of an existing pair extends that pair to three rather than splitting it,
 * and joining the ends of two supersets merges them, which is the only reading
 * of the request that leaves the invariant intact.
 *
 * Returns nothing when the two are already together, when `id` is not in the
 * list, or when there is no row on that side.
 */
export function joinSuperset(
  rows: readonly SupersetRow[],
  id: string,
  direction: 'up' | 'down',
): SupersetAssignment[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return [];

  const neighbourIndex = direction === 'up' ? index - 1 : index + 1;
  const target = rows[index];
  const neighbour = rows[neighbourIndex];
  if (!target || !neighbour) return [];

  /*
   * The target's own id wins when it has one, so extending a superset downwards
   * writes the row being added and leaves the rows already in it alone. Only
   * when the target is unattached does the neighbour's id carry, which is the
   * mirror of the same case. A fresh id is the last resort, for two rows that
   * were both standing alone.
   */
  const group = target.supersetGroup ?? neighbour.supersetGroup ?? nextGroup(rows);

  const moving = new Set([...spanOf(rows, index), ...spanOf(rows, neighbourIndex)]);
  const merged = rows.map((row) =>
    moving.has(row.id) ? { ...row, supersetGroup: group } : row,
  );

  return diff(rows, applyAssignments(merged, normalizeSupersets(merged)));
}

/**
 * Takes `id` out of whatever superset it is in.
 *
 * What is left over is not always a smaller superset. Pulling the middle
 * exercise out of three leaves the other two with a lift standing between them,
 * which is no longer a superset at all, and both are cleared. That is
 * `normalizeSupersets`' decision rather than one taken here, because a reorder
 * arrives at exactly the same state by a different route and has to be answered
 * the same way.
 */
export function leaveSuperset(
  rows: readonly SupersetRow[],
  id: string,
): SupersetAssignment[] {
  if (!rows.some((row) => row.id === id)) return [];

  const without = rows.map((row) => (row.id === id ? { ...row, supersetGroup: null } : row));

  return diff(rows, applyAssignments(without, normalizeSupersets(without)));
}

/**
 * The writes that restore the invariant at the top of this file.
 *
 * Three things are repaired, and each of them is something an ordinary edit
 * produces without meaning to:
 *
 * - **A run of one.** Deleting or substituting one half of a pair, or dragging
 *   a third exercise into the middle of it.
 * - **A group id in two places.** Dragging a member of A out past a member of
 *   B, which leaves A's id naming two separate stretches.
 * - Both at once, which is what removing the middle of three looks like.
 *
 * **Call this after a reorder as well as after a superset edit.** The drag
 * handle has no idea it is a superset control, and yet it is: dropping one
 * exercise between two others is the fastest way in the app to break a pair. A
 * reorder that writes nothing here is the common case and costs one pass over a
 * handful of rows, so there is no reason for a caller to try to be clever about
 * when to ask.
 *
 * The order of a list is never changed here, only the grouping. A run that
 * survives keeps its stored id, so the usual answer is an empty array.
 */
export function normalizeSupersets(rows: readonly SupersetRow[]): SupersetAssignment[] {
  const writes: SupersetAssignment[] = [];
  const claimed = new Set<number>();
  let ceiling = rows.reduce((max, row) => Math.max(max, row.supersetGroup ?? 0), 0);

  for (const span of spans(rows)) {
    if (span.group === null) continue;

    if (span.memberIds.length < 2) {
      for (const id of span.memberIds) writes.push({ id, supersetGroup: null });
      continue;
    }

    // First run to claim an id keeps it; a later one carrying the same id is a
    // split, and the second half is what moved, so the second half renames.
    if (claimed.has(span.group)) {
      ceiling += 1;
      for (const id of span.memberIds) writes.push({ id, supersetGroup: ceiling });
      claimed.add(ceiling);
      continue;
    }

    claimed.add(span.group);
  }

  return writes;
}

/** Applies assignments to a list, for callers holding a copy to write back. */
export function applyAssignments<T extends SupersetRow>(
  rows: readonly T[],
  assignments: readonly SupersetAssignment[],
): T[] {
  if (assignments.length === 0) return [...rows];

  const byId = new Map(assignments.map((entry) => [entry.id, entry.supersetGroup]));

  return rows.map((row) =>
    byId.has(row.id) ? { ...row, supersetGroup: byId.get(row.id) ?? null } : row,
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Every maximal contiguous stretch of equal group id, including the null ones
 * and the runs of one. `supersetRuns` filters this down to what counts as a
 * superset; `normalizeSupersets` needs the parts it throws away.
 */
function spans(
  rows: readonly SupersetRow[],
): { group: number | null; memberIds: string[] }[] {
  const out: { group: number | null; memberIds: string[] }[] = [];

  for (const row of rows) {
    const last = out[out.length - 1];
    // A null group is not an identity: two unattached rows side by side are two
    // spans, not one span of two, or clearing one would appear to clear both.
    if (last && last.group !== null && last.group === row.supersetGroup) {
      last.memberIds.push(row.id);
    } else {
      out.push({ group: row.supersetGroup, memberIds: [row.id] });
    }
  }

  return out;
}

/** The ids in the contiguous stretch `index` belongs to. Itself when unattached. */
function spanOf(rows: readonly SupersetRow[], index: number): Set<string> {
  const row = rows[index];
  if (!row) return new Set();
  if (row.supersetGroup === null) return new Set([row.id]);

  const ids = new Set([row.id]);
  for (let i = index - 1; i >= 0 && rows[i]?.supersetGroup === row.supersetGroup; i -= 1) {
    ids.add(rows[i]!.id);
  }
  for (let i = index + 1; i < rows.length && rows[i]?.supersetGroup === row.supersetGroup; i += 1) {
    ids.add(rows[i]!.id);
  }

  return ids;
}

/** An id no run in this list is using. */
function nextGroup(rows: readonly SupersetRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.supersetGroup ?? 0), 0) + 1;
}

/** The rows that actually differ, so an edit that settles back costs nothing. */
function diff(
  before: readonly SupersetRow[],
  after: readonly SupersetRow[],
): SupersetAssignment[] {
  const was = new Map(before.map((row) => [row.id, row.supersetGroup]));

  return after
    .filter((row) => was.get(row.id) !== row.supersetGroup)
    .map((row) => ({ id: row.id, supersetGroup: row.supersetGroup }));
}
