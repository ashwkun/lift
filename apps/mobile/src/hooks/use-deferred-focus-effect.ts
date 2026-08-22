/**
 * `useFocusEffect`, held back until the navigation transition has finished.
 *
 * This is the fix for the app's worst stutter, and it is worth being precise
 * about what the stutter actually was.
 *
 * Nearly every screen here opens by firing a batch of SQLite aggregates:
 * `getDashboardStats`, `getMuscleBoard`, a twelve-week volume scan. Wired
 * through plain `useFocusEffect` those queries start on the same tick the
 * screen is being pushed or the tab is being switched, and their results land
 * back on the JS thread a few frames later as a `setState` that re-renders the
 * whole screen: charts, SVG body maps, section lists. All of that has to happen
 * somewhere, and the one moment it must *not* happen is while a transition is
 * running, because that is the one moment the user is watching a specific
 * pixel move at a specific rate.
 *
 * The symptom was read as "the animation is janky", and the previous fix was to
 * delete the animations. The tab bar was pinned to `animation: 'none'` and the
 * stack was left on the platform default with a comment warning against
 * overriding it. That traded a stuttering transition for an instant cut to a
 * blank screen followed by a pop of content, which is not actually smoother,
 * only shorter. The animation was never the problem; the work landing on top of
 * it was.
 *
 * `InteractionManager` is the right lever because it already knows about both
 * kinds of transition. React Navigation's tab animation is an `Animated.timing`
 * with `isInteraction` left at its default, so it holds an interaction handle
 * for its whole run and this callback genuinely waits it out. A native stack
 * push animates entirely on the OS side and registers no handle, so there the
 * queue drains on the next flush, which is still after the mount render has
 * committed and the first frames of the push have gone out, which is the part
 * that mattered.
 *
 * The cost is that data arrives a frame or two later than it used to. That is
 * the trade being made deliberately: a screen whose numbers land 150ms after it
 * settles reads as fast, and a screen that arrives at 40fps reads as slow no
 * matter how quickly its numbers appear. Pair it with a `Reveal` so the late
 * arrival is a fade rather than a pop.
 *
 * Use it exactly like `useFocusEffect`. Including the `useCallback`, which is
 * still required for the same reason:
 *
 * ```ts
 * useDeferredFocusEffect(
 *   useCallback(() => {
 *     let cancelled = false;
 *     void load().then((next) => { if (!cancelled) setState(next); });
 *     return () => { cancelled = true; };
 *   }, []),
 * );
 * ```
 *
 * Do **not** use it for work the first frame depends on, or for subscriptions
 * that would miss an event during the deferral. It is for "fetch what this
 * screen displays", which is what all seventeen call sites in this app do.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { InteractionManager } from 'react-native';

/** What `useFocusEffect` accepts: a callback returning an optional teardown. */
type FocusEffect = () => undefined | void | (() => void);

export function useDeferredFocusEffect(effect: FocusEffect): void {
  useFocusEffect(
    useCallback(() => {
      // Two things have to be undone and they become known at different times,
      // hence two variables: the scheduled task always exists, the effect's own
      // teardown only exists if the effect got to run at all. Blurring during
      // the transition (a fast double tap across the tab bar) has to cancel
      // the first without waiting for a cleanup that will never be produced.
      let cancelled = false;
      let teardown: undefined | void | (() => void);

      const task = InteractionManager.runAfterInteractions(() => {
        // `cancel()` is not guaranteed to beat a task already dequeued for this
        // frame, so the flag is checked here as well rather than trusted to it.
        if (cancelled) return;
        teardown = effect();
      });

      return () => {
        cancelled = true;
        task.cancel();
        teardown?.();
      };
    }, [effect]),
  );
}
