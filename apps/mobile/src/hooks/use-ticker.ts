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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), intervalMs);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [intervalMs, enabled]);

  return now;
}
