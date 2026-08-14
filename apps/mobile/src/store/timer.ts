/**
 * Rest timer and workout clock.
 *
 * Both are stored as **absolute epoch deadlines**, never as a decrementing
 * counter. A counter driven by setInterval drifts, stops while the app is
 * backgrounded, and would show the wrong time the moment the user locks their
 * phone between sets — which is exactly when a rest timer matters.
 */

import { create } from 'zustand';

interface TimerState {
  /** Epoch ms when the current rest period ends; null when idle. */
  restEndsAt: number | null;
  /** The full duration that was started, for progress-ring rendering. */
  restTotalSeconds: number;
  /** Identifier of the set that triggered it, so the UI can anchor the bar. */
  restSourceSetId: string | null;

  startRest: (seconds: number, setId?: string) => void;
  /** Extends or trims a running timer. Negative values subtract. */
  adjustRest: (deltaSeconds: number) => void;
  stopRest: () => void;
}

export const useTimer = create<TimerState>((set, get) => ({
  restEndsAt: null,
  restTotalSeconds: 0,
  restSourceSetId: null,

  startRest: (seconds, setId) => {
    if (seconds <= 0) return;
    set({
      restEndsAt: Date.now() + seconds * 1000,
      restTotalSeconds: seconds,
      restSourceSetId: setId ?? null,
    });
  },

  adjustRest: (deltaSeconds) => {
    const { restEndsAt, restTotalSeconds } = get();
    if (restEndsAt === null) return;

    const next = restEndsAt + deltaSeconds * 1000;
    // Trimming below "now" should end the rest, not leave a negative countdown.
    if (next <= Date.now()) {
      set({ restEndsAt: null, restTotalSeconds: 0, restSourceSetId: null });
      return;
    }

    set({
      restEndsAt: next,
      restTotalSeconds: Math.max(1, restTotalSeconds + deltaSeconds),
    });
  },

  stopRest: () => set({ restEndsAt: null, restTotalSeconds: 0, restSourceSetId: null }),
}));

/** Seconds left on the rest timer, or null when idle. Never negative. */
export function remainingRestSeconds(restEndsAt: number | null, nowMs: number): number | null {
  if (restEndsAt === null) return null;
  return Math.max(0, Math.ceil((restEndsAt - nowMs) / 1000));
}
