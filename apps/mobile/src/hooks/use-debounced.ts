/**
 * A search term that stops changing until the typing stops.
 *
 * `useDeferredValue` was doing this job and is not enough on its own. It keeps
 * the *field* responsive by re-running the filter at transition priority, but
 * it still runs it once per keystroke: React abandons the in-flight pass and
 * starts another. Typing "bench press" is eleven passes over 6,800 rows, ten of
 * which describe a query nobody was looking at. Measured over the real catalog
 * that is 10.3ms of filtering against 0.8ms for the one pass that mattered, and
 * on a phone under Hermes it is the difference the user reports as lag.
 *
 * A debounce is the missing half: it collapses a burst of keystrokes into the
 * one query the person actually meant. Deferring is still worth keeping on top
 * of it, so the single pass that does run cannot block the field either.
 *
 * The trailing edge is the right one here. Firing on the leading edge would
 * search for "b" the instant it is typed, which is the broadest query in the
 * catalog and the least likely to be the intended one.
 *
 * Typed to strings rather than generically, because the one rule that makes it
 * feel right is about the empty string. Clearing the field is not typing, and
 * holding the results back for another 180ms after the user has emptied it
 * reads as the screen having stuck.
 */

import { useEffect, useState } from 'react';

/** Long enough to swallow a burst of typing, short enough not to feel held. */
export const SEARCH_DEBOUNCE_MS = 180;

export function useDebounced(value: string, delayMs: number = SEARCH_DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Already caught up. Bailing here rather than setting state is what keeps
    // this out of a render → effect → render loop.
    if (value === settled) return;

    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  // Applied in render rather than by shortcutting the timer above, so that
  // emptying the field costs no extra render pass: `settled` catches up on its
  // own a moment later and nothing on screen changes when it does.
  return value === '' ? value : settled;
}
