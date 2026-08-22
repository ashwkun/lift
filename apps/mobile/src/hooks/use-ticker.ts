import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Re-renders on an interval, returning the current epoch ms.
 *
 * Consumers derive their display from this timestamp rather than accumulating
 * their own count, so a backgrounded app resyncs to the true elapsed time on
 * resume instead of resuming a stale count. The listener also forces an
 * immediate update when the app returns to the foreground, avoiding a visible
 * lag of up to one interval.
 */
export function useTicker(intervalMs = 1000, enabled = true): number {
  // Lazily, so a mounted ticker's first render already holds the real time
  // instead of a placeholder something else has to correct.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    const tick = () => setNow(Date.now());

    /*
     * Re-enabling needs a reading of its own: a ticker that was switched off
     * holds the timestamp it stopped at, so a rest timer starting from a value
     * minutes old would show the wrong number until the first interval landed a
     * whole second later. Neither of the two obvious places for it will take it.
     * `Date.now()` is impure, so it cannot be read while rendering, and a
     * `setNow` in this effect's body is the cascading render the hooks rule is
     * about. A frame is the smallest honest delay left, and it is spent under
     * the animation that opens the bar.
     */
    const seed = requestAnimationFrame(tick);
    const interval = setInterval(tick, intervalMs);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });

    return () => {
      cancelAnimationFrame(seed);
      clearInterval(interval);
      subscription.remove();
    };
  }, [intervalMs, enabled]);

  return now;
}
