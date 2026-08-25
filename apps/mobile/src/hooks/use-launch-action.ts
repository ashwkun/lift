/**
 * An instruction carried in on a deep link, obeyed once per arrival.
 *
 * A home-screen widget's tap is a `lift://` link, and some of those links do not
 * merely open a screen: `?start=<token>` on a routine means "start this
 * session", and the screen has to act on it rather than render it. That is a
 * one-shot, and one-shots delivered through route parameters have two failure
 * modes that this hook exists to close.
 *
 * **Obeying it twice.** The parameter stays in the route for as long as the
 * screen is on the stack, so anything that re-runs on it — a re-render, a
 * remount, coming back through Recents — asks for a second session. Latched on
 * the value, so each arrival is acted on exactly once.
 *
 * **Obeying it once ever.** Tap the widget, get the "a workout is in progress"
 * dialog, dismiss it, tap the widget again: the same link arrives at the same
 * screen and a mount-only latch would ignore it. This is why the parameter
 * carries a token rather than a flag. What the token *is* never matters here,
 * only that it differs from the last one obeyed — see `asOf` in
 * `features/home-widgets/publisher.tsx` for what actually moves it and why that
 * is enough.
 *
 * `app/measurement/[kind].tsx` does the same thing inline against `?log=`,
 * because opening a sheet has to happen during render to make the first painted
 * frame. Everything here is asynchronous, so an effect is the right place.
 */

import { useEffect, useRef } from 'react';

export function useLaunchAction(token: string | undefined, run: () => void): void {
  /*
   * The last token obeyed, in a ref rather than state.
   *
   * Nothing renders from it, and it has to be readable by the effect that sets
   * it: as state, obeying a token would schedule a render whose only job is to
   * tell the next run of this effect something it already knew.
   */
  const obeyed = useRef<string | null>(null);

  /*
   * `run` is a dependency, so this re-runs whenever the caller rebuilds its
   * callback — which is most renders, since every caller closes over screen
   * state. That is deliberate rather than tolerated: the guard above is the
   * thing that decides whether the action happens, so a re-run costs one string
   * comparison and the alternative (holding the callback in a second ref) means
   * writing to a ref during render, which is exactly the pattern that makes a
   * stale closure hard to see.
   */
  useEffect(() => {
    if (!token || token === obeyed.current) return;
    obeyed.current = token;
    run();
  }, [token, run]);
}
