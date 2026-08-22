/**
 * Does a session exist: nothing else about it.
 *
 * A workout is app-global, and the two pieces of chrome that say so are the tab
 * bar on a phone and the side rail on a desktop. Both need the same one bit,
 * both are mounted on every screen, and the query is written the way it is
 * precisely because of that. It lived in `(tabs)/_layout` until the rail needed
 * it too; the reasoning moved here with it rather than being copied.
 *
 * One column, one row, and no join: this sits above every screen in the app, so
 * it pays on all of them. Drizzle's live query re-runs only when the table it
 * selects from changes (`expo-sqlite/query.js` filters the change listener by
 * table name), and `workouts` is written on start, finish and discard: not on
 * the set writes that fire every keystroke. Selecting the sets, or the
 * exercises, would put the whole logging screen's write traffic through a
 * re-render of the app's chrome.
 *
 * `useRows` is not needed: the unloaded frame reads as "no session", which is
 * chrome's own resting state, so the worst it can do is light one frame late.
 * Nothing here claims an absence the way an empty state would.
 *
 * Both callers may be mounted at once. The tab navigator stays alive under a
 * pushed screen, so on a wide window this runs twice. That is two subscriptions
 * on one table and one extra single-column read per workout-level write, which
 * is cheaper than threading the value down through a navigator that does not
 * otherwise care about it.
 */

import { and, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { workouts } from '@/db/schema';

export function useOpenSession(): boolean {
  const { data = [] } = useLiveQuery(
    db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .limit(1),
  );

  return data.length > 0;
}
