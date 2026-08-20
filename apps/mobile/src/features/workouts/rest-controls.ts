/**
 * Everything the two rest-timer surfaces share.
 *
 * The docked bar and the expandable sheet are two views of one clock, and the
 * failure mode of writing them out twice is not that they look slightly
 * different — it is that `+15` in the sheet extends the countdown while leaving
 * the scheduled notification where it was, and the phone rings fifteen seconds
 * early with the app in the user's pocket. Every action here is three things
 * that have to happen together (a haptic, a store write, and the bell moved to
 * match), and the derived reading is one function, so there is nowhere for the
 * two surfaces to drift apart.
 *
 * The store is reached through `getState()` rather than through selectors.
 * Nothing in here renders, the actions on a zustand store never change
 * identity, and subscribing to them would only add re-renders to components
 * that are already re-rendering once a second.
 */

import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@lift/shared';
import { useEffect, useState, type ComponentProps } from 'react';
import { AppState } from 'react-native';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '@/features/feedback/haptics';
import { cancelRestNotification, scheduleRestNotification } from '@/features/notifications/rest';
import { useSettings } from '@/store/settings';
import {
  OVERTIME_LIMIT_SECONDS,
  readRest,
  useTimer,
  type RestContext,
  type RestKind,
  type RestSnapshot,
} from '@/store/timer';
import { type Palette } from '@/theme';

/** Below this the readout turns amber — the "get back under the bar" window. */
const WARNING_SECONDS = 10;

/** What one press of a `±` control is worth, in both surfaces. */
export const ADJUST_SECONDS = 15;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface RestControls {
  /** Begins a rest period. Only reachable from the sheet, which is the one place idle rest can be started. */
  start: (seconds: number, context?: RestContext) => void;
  /** Extends or trims the running (or paused) period. Negative subtracts. */
  adjust: (deltaSeconds: number) => void;
  togglePause: () => void;
  /** Ends the period, whether that is skipping it or dismissing a finished one. */
  stop: () => void;
}

export function useRestControls(): RestControls {
  const notificationsEnabled = useSettings((state) => state.restTimerNotifications);

  /** Puts the scheduled bell back in step with whatever the clock now says. */
  const syncNotification = () => {
    const { restEndsAt, restExerciseName } = useTimer.getState();

    if (!notificationsEnabled || restEndsAt === null) {
      void cancelRestNotification();
      return;
    }

    const seconds = Math.ceil((restEndsAt - Date.now()) / 1000);
    if (seconds <= 0) {
      void cancelRestNotification();
      return;
    }

    void scheduleRestNotification(seconds, restExerciseName ?? undefined);
  };

  // Written as plain closures rather than `useCallback`s. The React Compiler is
  // on for this app (see `experiments.reactCompiler` in app.json), so hand-rolled
  // memoisation here would be noise around something already being done — and
  // none of these are read from a dependency array anyway; they are only ever
  // called from a press handler.
  return {
    start: (seconds, context) => {
      haptics.selection();
      useTimer.getState().startRest(seconds, context);
      syncNotification();
    },

    adjust: (deltaSeconds) => {
      // `selection`, not `countdownTick`: the tick belongs to the clock running
      // out, and it means nothing if four buttons say the same thing.
      haptics.selection();
      useTimer.getState().adjustRest(deltaSeconds);
      syncNotification();
    },

    togglePause: () => {
      haptics.selection();
      const state = useTimer.getState();

      if (state.restPausedSeconds !== null) state.resumeRest();
      else state.pauseRest();

      syncNotification();
    },

    stop: () => {
      // Skipping a rest that is still running is finishing it early, so it earns
      // the cue the clock would have given at zero. Dismissing a timer whose
      // bell has already rung does not ring it a second time.
      const snapshot = readRest(useTimer.getState(), Date.now());

      if (snapshot !== null && !snapshot.finished) haptics.restComplete();
      else haptics.selection();

      useTimer.getState().stopRest();
      void cancelRestNotification();
    },
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface RestProgressOptions {
  /**
   * Where the value settles when no rest is running.
   *
   * The bar passes nothing and keeps its last reading: it is still on screen for
   * the length of its slide-out, and draining the line under it would be a
   * second animation nobody asked for. The sheet passes 1, because an idle ring
   * is a duration waiting to be started rather than one that has run out.
   */
  idleValue?: number;
  /** False parks the animation — a closed sheet has nothing to draw. */
  enabled?: boolean;
}

/**
 * The fraction of the rest period still to run, as a UI-thread value.
 *
 * One animation per period, whose duration is the milliseconds actually left —
 * never a value nudged once a second from JS. That matters twice over: the
 * sweep is smooth instead of stepping, and it costs nothing on the JS thread,
 * which is busy with a controlled text input every time the user types a weight
 * while resting.
 *
 * Each surface gets its own shared value from its own call, driven by this one
 * definition — the docked line and the expanded ring are the same animation
 * written once rather than two clocks that agree by coincidence. They are not
 * the same *value*, and they do not need to be: both are functions of the same
 * deadline, so they cannot drift while the store holds one.
 */
export function useRestProgress({
  idleValue,
  enabled = true,
}: RestProgressOptions = {}): SharedValue<number> {
  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);

  const remaining = useSharedValue(1);
  const resync = useForegroundResync();

  useEffect(() => {
    // First, before any branch below decides what to do — several of them do
    // nothing at all, and "nothing" has to mean the line freezes where it is
    // rather than the previous period's run to zero carrying on underneath.
    cancelAnimation(remaining);

    if (!enabled) return;

    const totalMs = Math.max(1, restTotalSeconds) * 1000;

    if (restPausedSeconds !== null) {
      remaining.value = clamp01((restPausedSeconds * 1000) / totalMs);
      return;
    }

    if (restEndsAt === null) {
      if (idleValue !== undefined) remaining.value = idleValue;
      return;
    }

    const remainingMs = restEndsAt - Date.now();

    if (remainingMs <= 0) {
      remaining.value = 0;
      return;
    }

    // Two assignments on purpose: the first is where the animation starts from,
    // which is wherever the wall clock says we already are, and the second is
    // the run to zero from there.
    remaining.value = clamp01(remainingMs / totalMs);
    remaining.value = withTiming(0, {
      duration: remainingMs,
      // Linear because this is a clock face: any easing would make it lie about
      // how much time is left.
      easing: Easing.linear,
      /*
       * The one animation in the app that ignores the OS reduce-motion setting,
       * and it has to. `ReduceMotion.System` makes Reanimated jump straight to
       * the target value — here that is an empty ring and an empty line, drawn
       * the instant a two-minute rest begins. This is not motion decorating a
       * state change; it *is* the state, and a user who has asked for less
       * animation has not asked to be told their rest is over.
       */
      reduceMotion: ReduceMotion.Never,
    });
  }, [enabled, idleValue, remaining, restEndsAt, restPausedSeconds, restTotalSeconds, resync]);

  return remaining;
}

/**
 * Bumps a token whenever the app comes back to the foreground, and drops rest
 * that banked more than the overtime limit while it was away.
 *
 * A UI-thread animation is driven by the render loop, which stops while the app
 * is backgrounded — it resumes from where it froze rather than from where the
 * wall clock has since moved to. Re-running the animation on every return snaps
 * it back onto the real deadline.
 *
 * The expiry check lives here rather than on the once-a-second ticker: the only
 * ways to bank three minutes of overtime are to leave the app or to leave this
 * screen, and a store write fired out of a render that a clock drives is a
 * re-render loop waiting to be written.
 */
function useForegroundResync(): number {
  const [token, setToken] = useState(0);

  useEffect(() => {
    const dropExpired = () => {
      const state = useTimer.getState();
      const snapshot = readRest(state, Date.now());

      if (snapshot !== null && snapshot.overtime >= OVERTIME_LIMIT_SECONDS) state.stopRest();
    };

    dropExpired();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      dropExpired();
      setToken((current) => current + 1);
    });

    return () => subscription.remove();
  }, []);

  return token;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Everything a surface draws, resolved once from a single reading of the clock. */
export interface RestFrame {
  tone: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  status: string;
  readout: string;
  readoutLabel: string;
  paused: boolean;
  finished: boolean;
}

export function describeRest(
  rest: RestSnapshot,
  kind: RestKind | null,
  colors: Palette,
): RestFrame {
  const tone = rest.finished
    ? colors.success
    : rest.paused
      ? colors.textSecondary
      : rest.remaining <= WARNING_SECONDS
        ? colors.warning
        : colors.accent;

  // Rest after a warm-up is capped short on purpose, and forty-five seconds
  // where the user expects two minutes reads as a bug unless the timer says why.
  const status = rest.finished
    ? 'Rest complete'
    : rest.paused
      ? 'Paused'
      : kind === 'warmup'
        ? 'Warm-up rest'
        : 'Rest';

  const readout = rest.finished
    ? rest.overtime > 0
      ? `+${formatDuration(rest.overtime)}`
      : '0:00'
    : formatDuration(rest.remaining);

  /*
   * Spelled out for the screen reader, which reads "1:30" as "one thirty".
   * Deliberately a label and not a live region: live regions are Android-only,
   * and pointing one at a number that changes every second turns the screen
   * reader into a metronome. `RestCues` announces the two moments that matter.
   */
  const readoutLabel = rest.finished
    ? rest.overtime > 0
      ? `Rest complete, ${spokenDuration(rest.overtime)} over`
      : 'Rest complete'
    : `${status}, ${spokenDuration(rest.remaining)} left`;

  return {
    tone,
    icon: rest.finished ? 'checkmark-circle' : rest.paused ? 'pause' : 'timer-outline',
    status,
    readout,
    readoutLabel,
    paused: rest.paused,
    finished: rest.finished,
  };
}

/**
 * The duration in words.
 *
 * `formatDuration` writes "1:30", which VoiceOver and TalkBack both read as two
 * separate numbers. Every accessibility label on either surface quotes the
 * spoken form and leaves the colon form on screen, where it is the one that
 * scans.
 */
export function spokenDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];

  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (remainder > 0 || minutes === 0) {
    parts.push(`${remainder} second${remainder === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
