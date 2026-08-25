/**
 * Sound, haptics and screen-reader announcements for the rest countdown.
 *
 * Mounted once at the app root rather than inside the timer bar, because rest
 * keeps running while the user is on the exercise picker or reading their
 * history. The bell has to ring wherever they are. It renders nothing, so the
 * once-a-second re-render reconciles an empty component instead of the screen
 * underneath it.
 */

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

import { haptics } from '@/features/feedback/haptics';
import { systemRestBellPending } from '@/features/notifications/rest';
import {
  playCountdownBeep,
  playRestBell,
  primeRestSounds,
  releaseRestSounds,
} from '@/features/notifications/sounds';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';

/** Seconds before zero that get a haptic tick. */
const TICK_FROM = 3;

/**
 * The audible countdown: where it starts, and where it doubles in rate.
 *
 * Ten seconds out the beeps come every other second; from four they come every
 * second, so the run is 10, 8, 6, 4, 3, 2, 1 and then the bell. The gap halving
 * is the whole point: a fixed cadence tells you rest is ending, an
 * accelerating one tells you *how close* without anyone having to look at the
 * phone, which is the only reason to make noise in a gym at all.
 *
 * The odd seconds above four are silent by construction rather than by
 * accident: at one beep a second for ten seconds the cue stops being
 * information and starts being an alarm you learn to ignore.
 */
const BEEP_FROM = 10;
const BEEP_EVERY_SECOND_FROM = 4;

/** Whether the countdown beeps on this second. See `BEEP_FROM`. */
function beepsAt(remaining: number): boolean {
  if (remaining <= 0 || remaining > BEEP_FROM) return false;
  return remaining <= BEEP_EVERY_SECOND_FROM || remaining % 2 === 0;
}

/**
 * Seconds left at which the countdown is spoken.
 *
 * The readout carries an `accessibilityLabel` but no live region, because a
 * number that changes every second would be read out every second. A screen
 * reader user therefore hears nothing unless they go and find the bar, so the
 * two moments that change what they do: the warning window opening, and zero.
 * Are announced instead. This is not the countdown-cue preference, which
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

  // The decoded cues outlive any one workout, but not the app being torn down.
  useEffect(() => releaseRestSounds, []);

  // Decoded when the period starts rather than when the first beep is due: see
  // `primeRestSounds`. Keyed on `running` so it costs one call per rest period
  // instead of one per tick.
  useEffect(() => {
    if (running) primeRestSounds();
  }, [running]);

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
        // Only when the bell is ours to ring. On the notification and alarm
        // routes the OS is about to play the same tone through the same
        // deadline (`systemRestBellPending`), and two bells a frame apart is
        // worse than either of them alone.
        if (soundEnabled && !systemRestBellPending()) void playRestBell();
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

    // `remaining < prior` on both cues below, so that −15 and +15 can move the
    // clock without either of them firing on a second the countdown is walking
    // backwards through.
    if (remaining <= TICK_FROM && remaining < prior && countdownCues) {
      haptics.countdownTick();
    }

    // Gated on the same preference as the bell. "Alert sound" is the rest
    // timer's sound switch, and someone who turned it off did not mean "keep
    // the seven beeps and drop the one at the end". The haptic countdown has
    // its own toggle because it is felt rather than heard, and one of the two
    // is usable in a quiet gym where the other is not.
    if (remaining < prior && soundEnabled && beepsAt(remaining)) {
      void playCountdownBeep();
    }
  }, [restEndsAt, now, soundEnabled, countdownCues]);

  return null;
}
