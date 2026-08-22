/**
 * The app's side of the native ongoing notification.
 *
 * `modules/workout-live` is the renderer; this is the policy around it: when to
 * ask for the permission, what counts as a change worth crossing the bridge for,
 * and what "there is no session" has to actually do. It is the same shape as
 * `./workout`, which it supersedes on Android, and which remains the fallback
 * everywhere the native module is not in the binary.
 */

import {
  addWorkoutLiveActionListener,
  drainWorkoutLiveActions,
  getWorkoutLivePermissions,
  renderWorkoutLive,
  requestWorkoutLiveServicePermission,
  stopWorkoutLive,
  workoutLiveAvailable,
  type WorkoutLiveAction,
  type WorkoutLiveState,
} from '@modules/workout-live';

import { clearWorkoutNotice } from './workout';

export { workoutLiveAvailable, type WorkoutLiveAction, type WorkoutLiveState };

/**
 * The last state pushed, as its serialised form.
 *
 * The caller re-renders whenever any of its live queries answer, which is far
 * more often than the description actually changes, and since none of the
 * moving parts (the countdown, the elapsed clock) are *in* the description, most
 * of those renders produce a byte-identical object. Comparing here is what keeps
 * a session at roughly twenty pushes instead of one per render.
 */
let lastPushed: string | null = null;

/**
 * Whether a notification may currently be in the shade.
 *
 * True to begin with, for the reason `./workout` documents: an ongoing
 * notification outlives the process that posted it, so the first clear of a new
 * process has to actually run rather than assume a clean slate.
 */
let maybeShowing = true;

/** Once per process, like every other permission prompt in this app. */
let promptShown = false;

/**
 * Asks for the foreground-service permission, in context.
 *
 * Returns whether the notification can be posted at all, which is the answer the
 * caller acts on: the service permission only decides whether it is *protected*
 * (see `WorkoutLivePermissions.canRunService`), and a notification without the
 * service is still worth having.
 *
 * Called from the active workout screen next to `prepareRestNotifications`, and
 * for the same reason: "you are about to start lifting" is when a prompt about
 * tracking a workout makes sense, and app launch is not.
 */
export async function prepareLiveNotice(): Promise<boolean> {
  if (!workoutLiveAvailable) return false;

  const status = getWorkoutLivePermissions();

  if (!status.canRunService && !promptShown) {
    promptShown = true;
    // The answer is not branched on. It decides how well the notification
    // survives being backgrounded, never whether it appears, and both outcomes
    // lead to the same next step.
    await requestWorkoutLiveServicePermission();
  }

  // Re-read rather than trusting the value from before the prompt.
  return getWorkoutLivePermissions().canPost;
}

/**
 * Posts or redraws the notification.
 *
 * Safe to call on every render: an unchanged description never reaches the
 * bridge.
 */
export async function pushLiveNotice(state: WorkoutLiveState): Promise<void> {
  if (!workoutLiveAvailable) return;

  const key = JSON.stringify(state);
  if (key === lastPushed) return;
  lastPushed = key;

  try {
    await renderWorkoutLive(state);
    maybeShowing = true;
  } catch {
    // A revoked permission, or a service start the platform declined. The
    // workout is unaffected and there is nothing actionable to say here.
    lastPushed = null;
  }
}

/**
 * Removes the session notification, whichever renderer posted it.
 *
 * The one function every caller outside this file should use. There are two
 * renderers and only one is live in a given build, but "clear the notification"
 * is a single intention, and a caller that cleared one of them would leave the
 * other's notification in the shade on exactly the platform it did not think
 * about. Both clears are no-ops where their renderer is not the active one, so
 * calling both is always correct and never visible.
 */
export async function clearSessionNotice(): Promise<void> {
  await Promise.all([clearLiveNotice(), clearWorkoutNotice()]);
}

/** Removes the notification and stands the service down. */
async function clearLiveNotice(): Promise<void> {
  lastPushed = null;

  if (!workoutLiveAvailable) return;
  if (!maybeShowing) return;
  maybeShowing = false;

  try {
    await stopWorkoutLive();
  } catch {
    // Already gone.
  }
}

/**
 * Subscribes to button presses.
 *
 * The listener is a doorbell with no payload; this drains the native queue and
 * hands over what was actually there. Draining once on subscribe as well is what
 * picks up a press made while no listener existed, which is every press that
 * arrived in a process Android started only to deliver the broadcast.
 */
export function onLiveNoticeActions(
  handle: (actions: WorkoutLiveAction[]) => void,
): () => void {
  if (!workoutLiveAvailable) return () => {};

  let cancelled = false;

  const drain = () => {
    void drainWorkoutLiveActions().then((actions) => {
      if (cancelled || actions.length === 0) return;
      handle(actions);
    });
  };

  const subscription = addWorkoutLiveActionListener(drain);
  drain();

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}
