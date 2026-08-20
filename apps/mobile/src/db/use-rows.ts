/**
 * `useLiveQuery` with the one bit of state it leaves out: whether the query has
 * answered yet.
 *
 * Drizzle seeds its result to `[]` and only replaces it once the first query
 * resolves a tick or two later (`drizzle-orm/expo-sqlite/query.js`). Every
 * screen that reads `data.length === 0` therefore paints a confident "No
 * workouts yet" on mount and swaps it for real content a frame later. Empty and
 * not-yet-loaded are different facts and the app should stop conflating them.
 *
 * **Gate every empty state on `loaded`.** `if (!loaded) return null` — or return
 * the surrounding chrome with nothing in the list — before any "nothing here"
 * copy, count, or zeroed figure renders. The correct rendering of an unloaded
 * list is nothing at all: a shimmer that appears and vanishes inside 250ms is
 * its own flicker, and skeletons are deliberately not used anywhere in this app.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

/**
 * Anything `useLiveQuery` accepts: a select builder or a sync relational query.
 * Taken from the hook itself so this wrapper can never drift from it.
 */
type LiveQuery = Parameters<typeof useLiveQuery>[0];

export interface RowsResult<T> {
  /** Exactly what `useLiveQuery` returns as `data`, with inference intact. */
  rows: T;
  /** True once the query has reported — with rows, with none, or with an error. */
  loaded: boolean;
}

/**
 * `loaded` is derived from `updatedAt`, which drizzle stamps on every resolved
 * result, and from `error`.
 *
 * An error counts as loaded on purpose. A query that fails never stamps
 * `updatedAt`, so gating on it alone would leave that screen blank behind a
 * spinner that never stops — strictly worse than the empty state this wrapper
 * exists to suppress. A failed query renders as "nothing there", which is at
 * least true of what the app can show.
 *
 * One limitation to know about: `deps` re-runs the query but leaves the previous
 * `updatedAt` in place, so `loaded` stays true across a filter change while
 * `rows` are briefly stale. That is the right default for a list re-filtering
 * under the user's thumb; a screen whose *totals* would be wrong under the old
 * rows has to clear them itself.
 */
export function useRows<T extends LiveQuery>(
  query: T,
  deps: unknown[] = [],
): RowsResult<Awaited<T>> {
  const { data, error, updatedAt } = useLiveQuery(query, deps);

  return { rows: data, loaded: updatedAt !== undefined || error !== undefined };
}
