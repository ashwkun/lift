/**
 * Sound, haptics and screen-reader announcements for the rest countdown.
 *
 * Mounted once at the app root rather than inside the timer bar, because rest
 * keeps running while the user is on the exercise picker or reading their
 * history — the bell has to ring wherever they are. It renders nothing, so the
 * once-a-second re-render reconciles an empty component instead of the screen
 * underneath it.
 */

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

import { haptics } from '@/features/feedback/haptics';
import { playRestBell, releaseRestBell } from '@/features/notifications/bell';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';

/** Seconds before zero that get a tick. */
const TICK_FROM = 3;

/**
 * Seconds left at which the countdown is spoken.
 *
 * The readout carries an `accessibilityLabel` but no live region, because a
 * number that changes every second would be read out every second. A screen
 * reader user therefore hears nothing unless they go and find the bar, so the
 * two moments that change what they do — the warning window opening, and zero —
 * are announced instead. This is not the countdown-cue preference, which
 * governs whether the phone buzzes; it is the only way the bar speaks at all.
 */
const ANNOUNCE_FROM = 10;

/**
 * Cues are suppressed for this long after the app returns to the foreground.
 *
 * A rest period that ran out in the user's pocket has already been announced by
 * the scheduled notification. Without this, unlocking the phone afterwards
 * rings the bell a second time for a set they finished resting for minutes ago.
 */
const RESUME_GRACE_MS = 1500;

export function RestCues() {
  const restEndsAt = useTimer((state) => state.restEndsAt);
  const soundEnabled = useSettings((state) => state.soundEnabled);
  const countdownCues = useSettings((state) => state.restTimerCountdownCues);

  const running = restEndsAt !== null;
  const now = useTicker(1000, running);

  // The last whole second this hook saw, so a cue fires on the *transition*
  // into a second rather than on every render that happens to land inside it.
  const previous = useRef<number | null>(null);
  const foregroundedAt = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') foregroundedAt.current = Date.now();
    });

    return () => subscription.remove();
  }, []);

  // The decoded bell outlives any one workout, but not the app being torn down.
  useEffect(() => releaseRestBell, []);

  useEffect(() => {
    if (restEndsAt === null) {
      previous.current = null;
      return;
    }

    const remaining = Math.max(0, Math.ceil((restEndsAt - now) / 1000));
    const prior = previous.current;
    previous.current = remaining;

    // Nothing to compare against on the first tick of a new period, and a
    // render that didn't cross a second boundary has nothing to announce.
    if (prior === null || prior === remaining) return;

    if (Date.now() - foregroundedAt.current < RESUME_GRACE_MS) return;

    if (remaining === 0) {
      // Guarded on `prior` so extending an already-finished timer and letting it
      // lapse again is the only way to hear this twice.
      if (prior > 0) {
        if (soundEnabled) void playRestBell();
        haptics.restComplete();
        AccessibilityInfo.announceForAccessibility('Rest complete');
      }
      return;
    }

    // Crossing the threshold rather than landing on it: −15 can take the clock
    // from twenty seconds to five without ever passing through ten.
    if (remaining <= ANNOUNCE_FROM && prior > ANNOUNCE_FROM) {
      const unit = remaining === 1 ? 'second' : 'seconds';
      AccessibilityInfo.announceForAccessibility(`${remaining} ${unit} of rest left`);
    }

    if (remaining <= TICK_FROM && remaining < prior && countdownCues) {
      haptics.countdownTick();
    }
  }, [restEndsAt, now, soundEnabled, countdownCues]);

  return null;
}
