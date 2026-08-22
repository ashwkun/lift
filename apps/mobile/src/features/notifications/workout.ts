/**
 * The persistent "workout in progress" notification: the fallback renderer.
 *
 * Posted for as long as a workout is open, so the session is reachable from the
 * shade without hunting for the app, and so a workout left running is visible
 * rather than quietly accumulating hours.
 *
 * ## What this is not
 *
 * It is not a foreground service. Android keeps showing the notification once
 * posted, but the content only changes while JavaScript is running, which
 * means while the app is foregrounded. Pocket the phone mid-workout and the
 * elapsed time freezes at whatever it last read; it catches up on return.
 * Live-ticking text in the shade needs either `setUsesChronometer` or a real
 * foreground service, and `expo-notifications` exposes neither.
 *
 * ## What replaced it
 *
 * `modules/workout-live` does expose both, so on Android that is what draws the
 * session: a countdown SystemUI ticks whether or not this app is running, a
 * progress bar, and `+15s` / `Pause` / `Skip` / `Complete set` buttons that
 * reach back into the store. `features/workouts/workout-notice.tsx` picks
 * between the two and describes the session once for both.
 *
 * This file stays because that module is Android-only and is not in the Expo Go
 * binary, and a frozen elapsed time is a great deal better than no notification.
 * Nothing new should be added here; add it to the native renderer and let this
 * one keep saying the little it can.
 *
 * The rest-timer alert in `./rest` is unaffected by either: it is a scheduled
 * notification, so the OS fires it on time regardless of whether the app is
 * running, and it stays the only thing that makes a sound.
 */

import { Platform } from 'react-native';

import { getNotifications } from './module';
import { configureNotificationHandler, ONGOING_WORKOUT_TYPE } from './presentation';

/**
 * Deliberately separate from the rest-timer channel, and deliberately LOW.
 *
 * A status notification that buzzed or made a sound every time the set count
 * changed would be intolerable. LOW means it appears in the shade with no
 * sound, no vibration and no heads-up banner, and it also gives the user a
 * single switch in system settings to turn this off without losing the rest
 * alert, which is the only "off" this notification has.
 */
const ANDROID_CHANNEL_ID = 'workout-ongoing';

/** Stable, so re-posting updates the existing notification instead of stacking. */
const NOTIFICATION_ID = 'workout-ongoing';

export interface WorkoutNoticeContent {
  workoutName: string;
  /** Line under the title: current exercise, set tally, elapsed. */
  detail: string;
}

/**
 * Channel creation and the permission prompt are once-per-process.
 *
 * `showWorkoutNotice` is called on every content change: roughly once a minute
 * for a whole session, and neither of those belongs on that path. Asking for
 * permission repeatedly is the worse of the two: the OS shows the dialog once
 * and silently denies afterwards, so a retry loop is pure noise.
 */
let channelReady = false;
let promptShown = false;
/**
 * The last body posted.
 *
 * Re-posting identical content still costs an IPC round trip and can make the
 * shade flicker, and the caller re-renders far more often than the rendered
 * string actually changes. A per-second tick only moves a minute-granularity
 * elapsed time once in sixty.
 */
let lastPosted: string | null = null;

/**
 * Whether a notification may currently be in the shade.
 *
 * Starts `true` on purpose. An ongoing notification outlives the process that
 * posted it (force-quitting the app mid-workout leaves it sitting there) so
 * the first clear of a new process has to actually run rather than assume a
 * clean slate. After that it tracks reality, which keeps the no-workout case
 * from crossing the bridge on every render.
 */
let maybeShowing = true;

async function prepare(): Promise<boolean> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return false;

  if (Platform.OS === 'android' && !channelReady) {
    channelReady = true;
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Workout in progress',
      importance: Notifications.AndroidImportance.LOW,
      // A status line has nothing to announce; the rest timer does the alerting.
      sound: null,
      vibrationPattern: null,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  // Re-read rather than caching the answer: a user who grants the permission
  // from system settings mid-session should get the notification without
  // having to restart the app. Only the *prompt* is once-per-process.
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  if (promptShown || !existing.canAskAgain) return false;

  promptShown = true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Posts or updates the notification.
 *
 * Safe to call on every render. Identical content is dropped before it
 * reaches the OS.
 */
export async function showWorkoutNotice(content: WorkoutNoticeContent): Promise<void> {
  const key = `${content.workoutName}\0${content.detail}`;
  if (key === lastPosted) return;

  try {
    const granted = await prepare();
    if (!granted) return;

    // `prepare` already returned false if this were null; re-read rather than
    // asserting, so the compiler carries the guarantee instead of a comment.
    const Notifications = getNotifications();
    if (!Notifications) return;

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: content.workoutName,
        body: content.detail,
        data: { type: ONGOING_WORKOUT_TYPE },
        // `sticky` maps to setOngoing: no swipe-to-dismiss. `autoDismiss:false`
        // maps to setAutoCancel(false), so tapping through to the workout
        // leaves the notification in place rather than clearing it. The
        // workout is still running, so the status should still be there.
        sticky: true,
        autoDismiss: false,
        color: '#D2F34B',
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      // Immediate, but routed through the workout channel rather than the
      // default one. `trigger: null` also delivers immediately, but it posts
      // to Android's default channel, which is HIGH importance, so every
      // minute's update would arrive with a sound and a heads-up banner.
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    });

    lastPosted = key;
    maybeShowing = true;
  } catch {
    // A revoked permission or a channel the user disabled. The workout itself
    // is unaffected, and there is nothing actionable to tell them here.
  }
}

/** Removes the notification. Called when the workout is finished or discarded. */
export async function clearWorkoutNotice(): Promise<void> {
  lastPosted = null;

  const Notifications = getNotifications();
  if (!Notifications) return;

  if (!maybeShowing) return;
  maybeShowing = false;

  try {
    // Both halves are needed: the first removes it from the shade if it has
    // already been delivered, the second drops the request if it somehow has
    // not been yet.
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
  } catch {
    // Already gone.
  }
}
