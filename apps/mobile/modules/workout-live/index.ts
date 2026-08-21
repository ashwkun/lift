/**
 * `workout-live` — the ongoing workout notification, rendered natively.
 *
 * A local Expo module rather than anything in `android/`, because `android/` is
 * generated: it is gitignored and `pnpm prebuild` runs `expo prebuild --clean`,
 * which deletes it. Everything here survives that, and `settings.gradle` already
 * calls `expoAutolinking.useExpoModules()`, so it links with no configuration.
 *
 * ## Why this exists at all
 *
 * `expo-notifications` cannot express three things this notification needs: a
 * clock that ticks while the app is not running, a progress bar, and buttons
 * that reach back into the session. The first is the one that matters — see
 * `WorkoutLiveNotification.kt` for how Android renders it, and why that means
 * this module holds no timer of its own.
 *
 * Android only. On iOS and in Expo Go `requireOptionalNativeModule` returns
 * null and every export below no-ops, which is the same shape as
 * `features/notifications/module.ts` and is handled at the one call site in
 * `features/workouts/workout-notice.tsx`.
 */

import { requireOptionalNativeModule } from 'expo';
import { type EventSubscription } from 'expo-modules-core';

/**
 * What the shade should say.
 *
 * Note what is *not* here: no remaining seconds, no elapsed minutes, no
 * progress fraction. Times are absolute epochs, exactly as `store/timer.ts`
 * holds them, and the native side hands them to Android to render. A field
 * holding "83 seconds left" would be stale before it arrived.
 */
export interface WorkoutLiveState {
  /** Workout name. */
  title: string;
  /** Current exercise and set tally — "Bench Press · 12 sets". */
  line: string;
  /** Epoch ms the workout started. Renders as a count-up clock. */
  startedAtMs: number;
  /** Epoch ms rest ends, or null when idle or paused. Renders as a countdown. */
  restEndsAtMs: number | null;
  /** Seconds frozen on a paused period; null whenever it is running. */
  restPausedSeconds: number | null;
  /** The span the countdown covers, for the progress bar. */
  restTotalSeconds: number;
  /** What the rest belongs to — an exercise name, or "Warm-up rest". */
  restLabel: string | null;
  /** What one press of the adjust button is worth, so it can be labelled with it. */
  adjustSeconds: number;
  /** Whether there is an unchecked set to tick. Hides the action when there is not. */
  canCompleteSet: boolean;
  /** `#RRGGBB`, tinting the icon and app name in the notification header. */
  accentColor: string;
}

/** A button press, drained from the native queue. */
export type WorkoutLiveAction =
  | { type: 'complete-set' }
  | { type: 'adjust-rest'; seconds: number }
  | { type: 'toggle-pause' }
  | { type: 'skip-rest' };

export interface WorkoutLivePermissions {
  /** POST_NOTIFICATIONS. False means there is nothing to show at all. */
  canPost: boolean;
  /**
   * ACTIVITY_RECOGNITION, the runtime half of the `health` foreground-service
   * type on Android 14+. False still leaves a working notification — it is only
   * no longer protected from being killed in the background.
   */
  canRunService: boolean;
}

interface WorkoutLiveNativeModule {
  getPermissionStatus(): WorkoutLivePermissions;
  requestServicePermission(): Promise<boolean>;
  render(state: WorkoutLiveState): Promise<void>;
  stop(): Promise<void>;
  drainActions(): Promise<WorkoutLiveAction[]>;
  addListener(event: 'onPendingActions', listener: () => void): EventSubscription;
}

const native = requireOptionalNativeModule<WorkoutLiveNativeModule>('WorkoutLive');

/** False on iOS, on the web, and in Expo Go, where the native half is not in the binary. */
export const workoutLiveAvailable = native !== null;

export function getWorkoutLivePermissions(): WorkoutLivePermissions {
  return native?.getPermissionStatus() ?? { canPost: false, canRunService: false };
}

export async function requestWorkoutLiveServicePermission(): Promise<boolean> {
  return (await native?.requestServicePermission()) ?? false;
}

/**
 * Draws the session, raising the foreground service if it is not already up.
 *
 * One verb rather than a start/update pair: whether the service needs raising is
 * a question only the native side can answer for certain, and it answers it on
 * every call. See `WorkoutLiveModule.kt`.
 */
export async function renderWorkoutLive(state: WorkoutLiveState): Promise<void> {
  await native?.render(state);
}

export async function stopWorkoutLive(): Promise<void> {
  await native?.stop();
}

/**
 * Removes and returns every press since the last call.
 *
 * The queue is the only channel a press travels on — the event below carries no
 * payload and is purely a signal to call this. One channel means a press cannot
 * arrive twice, and it means a press made while the app was not listening is
 * still here when it starts.
 */
export async function drainWorkoutLiveActions(): Promise<WorkoutLiveAction[]> {
  return (await native?.drainActions()) ?? [];
}

export function addWorkoutLiveActionListener(listener: () => void): EventSubscription | null {
  return native?.addListener('onPendingActions', listener) ?? null;
}
