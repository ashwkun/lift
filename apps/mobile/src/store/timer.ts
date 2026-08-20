/**
 * Rest timer and workout clock.
 *
 * Both are stored as **absolute epoch deadlines**, never as a decrementing
 * counter. A counter driven by setInterval drifts, stops while the app is
 * backgrounded, and would show the wrong time the moment the user locks their
 * phone between sets — which is exactly when a rest timer matters.
 *
 * Pausing is the one exception: there is no deadline to point at while the
 * clock is stopped, so the remaining time is frozen as a duration and turned
 * back into a deadline on resume.
 *
 * That choice is also what makes the rest period survive being killed. The OS
 * notification outlives the process, so a countdown that died with it would
 * leave the bell ringing for a timer the app no longer believes in. Because the
 * state is an epoch and not a tick count, restoring it is just reading the
 * number back — nothing has to be replayed or caught up. `restoreRest` below is
 * the only entry point for that; `store/timer-persistence.ts` owns the disk.
 */

import { create } from 'zustand';

/** Rest keeps counting past zero, but stops occupying the screen after this. */
export const OVERTIME_LIMIT_SECONDS = 180;

/**
 * What kind of set the rest follows.
 *
 * Rest after a warm-up is deliberately capped short, and a bar that just showed
 * a smaller number would read as a bug. Carrying the kind lets it say so.
 */
export type RestKind = 'working' | 'warmup';

/** Where a rest period came from, so the bar can label it and link back. */
export interface RestContext {
  setId?: string;
  exerciseId?: string;
  exerciseName?: string;
  kind?: RestKind;
}

interface TimerState {
  /** Epoch ms when rest ends. Null while idle **and** while paused. */
  restEndsAt: number | null;
  /** Seconds frozen on the clock while paused; null whenever it is running. */
  restPausedSeconds: number | null;
  /** The span the current countdown covers, for progress rendering. */
  restTotalSeconds: number;
  /** The set that triggered it, so the UI can anchor the bar. */
  restSourceSetId: string | null;
  restExerciseId: string | null;
  restExerciseName: string | null;
  /** Null while idle; otherwise the class of set this rest follows. */
  restKind: RestKind | null;

  startRest: (seconds: number, context?: RestContext) => void;
  /** Extends or trims the timer, running or paused. Negative values subtract. */
  adjustRest: (deltaSeconds: number) => void;
  pauseRest: () => void;
  resumeRest: () => void;
  stopRest: () => void;
  /**
   * Puts a persisted rest period back, dropping one whose deadline has already
   * passed. See `restoreRest` in the store body for why it can't just assign.
   */
  restoreRest: (fields: RestFields) => void;
}

/** The whole of the rest period: what gets written to disk and read back. */
export type RestFields = Pick<
  TimerState,
  | 'restEndsAt'
  | 'restPausedSeconds'
  | 'restTotalSeconds'
  | 'restSourceSetId'
  | 'restExerciseId'
  | 'restExerciseName'
  | 'restKind'
>;

const IDLE: RestFields = {
  restEndsAt: null,
  restPausedSeconds: null,
  restTotalSeconds: 0,
  restSourceSetId: null,
  restExerciseId: null,
  restExerciseName: null,
  restKind: null,
};

export const useTimer = create<TimerState>((set, get) => ({
  ...IDLE,

  startRest: (seconds, context) => {
    if (seconds <= 0) return;

    set({
      restEndsAt: Date.now() + seconds * 1000,
      restPausedSeconds: null,
      restTotalSeconds: seconds,
      restSourceSetId: context?.setId ?? null,
      restExerciseId: context?.exerciseId ?? null,
      restExerciseName: context?.exerciseName ?? null,
      restKind: context?.kind ?? 'working',
    });
  },

  adjustRest: (deltaSeconds) => {
    const state = get();

    if (state.restPausedSeconds !== null) {
      const next = state.restPausedSeconds + deltaSeconds;
      if (next <= 0) {
        set(IDLE);
        return;
      }

      set({
        restPausedSeconds: next,
        restTotalSeconds: Math.max(next, state.restTotalSeconds + deltaSeconds),
      });
      return;
    }

    if (state.restEndsAt === null) return;

    const now = Date.now();
    const overtime = state.restEndsAt <= now;

    // Past zero the deadline is already behind us, so "+15" has to mean fifteen
    // seconds from *now* — adding to a stale deadline would move a number the
    // user cannot see and appear to do nothing.
    const next = (overtime ? now : state.restEndsAt) + deltaSeconds * 1000;

    if (next <= now) {
      set(IDLE);
      return;
    }

    set({
      restEndsAt: next,
      // Extending out of overtime restarts the span, so the bar sweeps from
      // empty again rather than sitting full for the extra time just granted.
      restTotalSeconds: overtime ? deltaSeconds : Math.max(1, state.restTotalSeconds + deltaSeconds),
    });
  },

  pauseRest: () => {
    const { restEndsAt } = get();
    if (restEndsAt === null) return;

    const remaining = Math.ceil((restEndsAt - Date.now()) / 1000);
    // Nothing left to freeze once the bell has already rung.
    if (remaining <= 0) return;

    set({ restEndsAt: null, restPausedSeconds: remaining });
  },

  resumeRest: () => {
    const { restPausedSeconds } = get();
    if (restPausedSeconds === null) return;

    set({ restEndsAt: Date.now() + restPausedSeconds * 1000, restPausedSeconds: null });
  },

  stopRest: () => set(IDLE),

  restoreRest: (fields) => {
    // A paused period is a duration, so however long the app was gone it comes
    // back exactly as it was left. A running one is a deadline, and one that
    // expired while the process was dead belongs to a set the user finished
    // resting for long ago — restoring it would open the bar on several minutes
    // of overtime for a rest nobody is taking. The scheduled notification has
    // already said what there was to say, so that case comes back idle.
    if (fields.restPausedSeconds !== null && fields.restPausedSeconds > 0) {
      set({ ...fields, restEndsAt: null });
      return;
    }

    if (fields.restEndsAt !== null && fields.restEndsAt > Date.now()) {
      set({ ...fields, restPausedSeconds: null });
      return;
    }

    set(IDLE);
  },
}));

/** Everything the UI needs about the current rest period, derived from one clock read. */
export interface RestSnapshot {
  /** Whole seconds left. Zero once the timer has run out. */
  remaining: number;
  /** Whole seconds elapsed *past* zero. Zero while still counting down. */
  overtime: number;
  /** Elapsed fraction of the span, 0 → 1. Pinned at 1 once past zero. */
  progress: number;
  paused: boolean;
  finished: boolean;
  /**
   * Unrounded milliseconds left. Drives the progress animation's duration,
   * where rounding to a second would leave a visible hitch at the end.
   */
  remainingMs: number;
}

/**
 * Reads the rest period as of `nowMs`, or null when no timer is running.
 *
 * Every displayed value comes from this one function so the readout, the bar
 * and the completion cue can never disagree about what second it is.
 */
export function readRest(
  state: Pick<TimerState, 'restEndsAt' | 'restPausedSeconds' | 'restTotalSeconds'>,
  nowMs: number,
): RestSnapshot | null {
  const total = Math.max(1, state.restTotalSeconds);

  if (state.restPausedSeconds !== null) {
    return {
      remaining: state.restPausedSeconds,
      overtime: 0,
      progress: clamp01(1 - state.restPausedSeconds / total),
      paused: true,
      finished: false,
      remainingMs: state.restPausedSeconds * 1000,
    };
  }

  if (state.restEndsAt === null) return null;

  const remainingMs = state.restEndsAt - nowMs;

  if (remainingMs <= 0) {
    return {
      remaining: 0,
      overtime: Math.floor(-remainingMs / 1000),
      progress: 1,
      paused: false,
      finished: true,
      remainingMs: 0,
    };
  }

  return {
    remaining: Math.ceil(remainingMs / 1000),
    overtime: 0,
    progress: clamp01(1 - remainingMs / (total * 1000)),
    paused: false,
    finished: false,
    remainingMs,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
