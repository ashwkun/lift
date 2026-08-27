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
import {
  cancelRestNotification,
  systemRestBellPending,
  systemRestBellRangSince,
} from '@/features/notifications/rest';
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

/**
 * How long zero waits for the system bell before the app rings its own.
 *
 * On the notification and alarm routes the bell is the OS's to ring, and the app
 * now asks for an alarm the OS will ring on time: see
 * `plugins/with-exact-alarms.ts`, without which `expo-notifications` schedules
 * an inexact alarm that a sleeping phone sits on until it wakes for its own
 * reasons. That is the fix for a late bell, and this is what covers the cases an
 * exact alarm still cannot: Do Not Disturb, a channel the user has muted, a
 * revoked `SCHEDULE_EXACT_ALARM` on Android 12, a delivery the OS simply drops.
 * In every one of them the app used to have nothing to say at zero, because it
 * had already stepped aside for a bell that was never going to ring.
 *
 * So it steps aside for this long instead of for good. A second of silence at
 * zero is inside the rhythm the countdown has already set; ten is the user
 * deciding the timer is broken.
 */
const SYSTEM_BELL_GRACE_MS = 1000;

/**
 * How far before the tick that reaches zero a system bell still counts.
 *
 * The countdown is a once-a-second tick, so the deadline can pass up to a second
 * before this hook notices it has. An alarm that landed in that gap has already
 * rung, and without this window the fallback would put a second bell on top of
 * one the user just heard.
 */
const SYSTEM_BELL_EARLY_MS = 1500;

/**
 * Past this, the fallback has missed its moment and stands down.
 *
 * A timeout is not a promise about when it runs. RN's `JavaTimerManager` drops
 * the choreographer callback on `onHostPause`, so a phone locked inside the
 * grace window parks this until the app is opened again and then runs it for a
 * deadline that is minutes old. By then the OS has delivered the bell to a lock
 * screen the user has already read, and firing would ring for a finished set
 * and dismiss the notification saying so.
 */
const SYSTEM_BELL_STALE_MS = 3000;

/** The armed fallback bell, if one is waiting on the OS. */
let fallbackBell: ReturnType<typeof setTimeout> | null = null;

function disarmFallbackBell(): void {
  if (fallbackBell === null) return;

  clearTimeout(fallbackBell);
  fallbackBell = null;
}

/**
 * Rings the bell for `deadline`, or gives the OS its beat and then rings it.
 *
 * Module-level rather than a hook, and holding its handle in a module variable,
 * because there is one rest period and one `RestCues` in the app. The effect
 * that calls this re-runs every second, so the armed timer cannot be cleaned up
 * by that effect: it would be cancelled by the tick that arrives alongside it.
 * It is disarmed instead at the two moments that actually invalidate it, which
 * are the period ending and the tree being torn down.
 */
function ringRestBell(deadline: number): void {
  disarmFallbackBell();

  if (!systemRestBellPending()) {
    void playRestBell();
    return;
  }

  // Backgrounded, the OS bell is the entire alert: it arrives with a banner, on
  // the volume the user picked, and a background delivery never reaches JS, so
  // there is no receipt to wait for and nothing here that could tell a late
  // bell from one that is about to ring. Rarely reached, since the tick that
  // calls this has stopped by then, and kept because "rarely" is not "never":
  // the pause and the tick race on the frame the app is leaving the screen.
  if (AppState.currentState !== 'active') return;

  fallbackBell = setTimeout(() => {
    fallbackBell = null;

    if (systemRestBellRangSince(deadline - SYSTEM_BELL_EARLY_MS)) return;
    if (Date.now() - deadline > SYSTEM_BELL_STALE_MS) return;

    // A period that has since been skipped, or a new one started inside the
    // grace window. Either way the bell would be for a deadline nobody is
    // waiting on, and the cancellation below would take the new period's alert
    // down with it.
    if (useTimer.getState().restEndsAt !== deadline) return;

    // The alert is ours now. Left scheduled it would arrive whenever the system
    // got round to it, which is a second bell for a rest that is already over.
    void cancelRestNotification();
    void playRestBell();
  }, SYSTEM_BELL_GRACE_MS);
}

export function RestCues() {
  const restEndsAt = useTimer((state) => state.restEndsAt);
  const soundEnabled = useSettings((state) => state.soundEnabled);
  const countdownCues = useSettings((state) => state.restTimerCountdownCues);
  const countdownBeeps = useSettings((state) => state.restTimerCountdownBeeps);

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

  // The decoded cues outlive any one workout, but not the app being torn down,
  // and neither does a bell still waiting on the OS.
  useEffect(
    () => () => {
      disarmFallbackBell();
      releaseRestSounds();
    },
    [],
  );

  // Decoded when the period starts rather than when the first beep is due: see
  // `primeRestSounds`. Keyed on `running` so it costs one call per rest period
  // instead of one per tick.
  useEffect(() => {
    if (running) primeRestSounds();
  }, [running]);

  useEffect(() => {
    if (restEndsAt === null) {
      previous.current = null;
      disarmFallbackBell();
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
        // Not unconditionally the app's to play. On the notification and alarm
        // routes the OS is about to play the same tone through the same
        // deadline, and two bells a frame apart is worse than either of them
        // alone, so `ringRestBell` gives it a beat to do so first.
        if (soundEnabled) ringRestBell(restEndsAt);
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
    //
    // `restTimerCountdownBeeps` is the switch for the seven on their own, for a
    // gym where the bell is welcome and a countdown out of a pocket is not.
    // Which is only ever a pocket with the screen still on: this clock is a JS
    // timer, and RN takes the choreographer callback away on `onHostPause`, so
    // the countdown stops dead the moment the app leaves the screen and no
    // preference here can carry it any further. The cue that survives a locked
    // phone is the bell, and it survives by being an alarm the OS holds rather
    // than a sound this file plays.
    if (remaining < prior && soundEnabled && countdownBeeps && beepsAt(remaining)) {
      void playCountdownBeep();
    }
  }, [restEndsAt, now, soundEnabled, countdownCues, countdownBeeps]);

  return null;
}
