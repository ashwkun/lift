/**
 * Local notification for the rest timer.
 *
 * The timer itself is driven by an absolute deadline in JS, but that only fires
 * while the app is foregrounded. A scheduled local notification is what actually
 * tells the user rest is over once they've pocketed their phone.
 *
 * While the app *is* foregrounded the notification stays silent and invisible:
 * `RestCues` already rings the same bell and the timer bar is on screen, so
 * presenting it too would double the sound and cover the workout with a banner
 * describing something the user is looking at.
 */

import { Platform } from 'react-native';

import { useTimer } from '@/store/timer';

import { getNotifications } from './module';
import { configureNotificationHandler } from './presentation';

/**
 * Bumped from `rest-timer` when the bell replaced the system sound.
 *
 * An Android channel's sound is fixed at creation and cannot be changed
 * afterwards. Updating the existing channel is silently ignored, so anyone
 * who had already opened the app would keep the old tone forever. A new id is
 * the only way to move them across.
 */
const ANDROID_CHANNEL_ID = 'rest-timer-v2';
const LEGACY_ANDROID_CHANNEL_ID = 'rest-timer';

/**
 * Bundled by the `expo-notifications` config plugin (see `app.json`), which
 * copies it into the iOS bundle and Android's `res/raw`. Referenced by bare
 * filename on both platforms, and only resolvable in a dev/EAS build. Expo Go
 * has no way to carry a custom sound.
 */
const SOUND_FILE = 'rest_complete.wav';

/**
 * There is one rest period at a time, so there is one notification at a time.
 *
 * Fixing the identifier makes that structural: re-scheduling replaces the
 * pending request instead of adding a second one, and cancelling works from a
 * cold start, where a module-level handle from the previous process is gone but
 * the request the OS is holding is not.
 */
const REST_NOTIFICATION_ID = 'rest-timer-complete';

/**
 * Requests permission and prepares the Android channel.
 * Returns whether notifications can actually be delivered.
 */
export async function prepareRestNotifications(): Promise<boolean> {
  configureNotificationHandler();

  // Indistinguishable from a denied permission to every caller, which is the
  // point: the timer bar already renders the same way when this returns false.
  const Notifications = getNotifications();
  if (!Notifications) return false;

  if (Platform.OS === 'android') {
    // Android requires a channel before anything can be posted; importance
    // HIGH is what allows a heads-up banner over the lock screen.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Rest Timer',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      sound: SOUND_FILE,
      // The bell is the point of the alert, so it should not be muted by Do Not
      // Disturb's default bypass rules any more than an alarm would be.
      bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Leaves the pre-bell channel behind rather than orphaning it in the
    // system settings list under the same user-facing name.
    await Notifications.deleteNotificationChannelAsync(LEGACY_ANDROID_CHANNEL_ID).catch(() => {});
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  // Don't re-prompt if the user has already said no. The OS won't show the
  // dialog twice anyway, and asking mid-workout is intrusive.
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Schedules the "rest over" alert, replacing any previously scheduled one.
 *
 * Called on every start, adjustment, pause and resume: the scheduled time and
 * the on-screen countdown have to agree, and the only way to move a scheduled
 * notification is to cancel it and post a new one.
 */
export async function scheduleRestNotification(
  seconds: number,
  exerciseName?: string,
): Promise<void> {
  if (seconds <= 0) return;

  const Notifications = getNotifications();
  if (!Notifications) return;

  await cancelRestNotification();

  await Notifications.scheduleNotificationAsync({
    identifier: REST_NOTIFICATION_ID,
    content: {
      title: 'Rest complete',
      body: exerciseName ? `Time for your next set of ${exerciseName}.` : 'Time for your next set.',
      sound: SOUND_FILE,
      // A rest timer is the one alert that is useless if it arrives late, so it
      // asks to break through Focus modes. iOS honours this only with the
      // time-sensitive entitlement and quietly downgrades to a normal alert
      // otherwise, which is the behaviour we'd have had anyway.
      ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
    },
  });
}

/**
 * Cancels the pending alert. Called when rest is skipped, paused or adjusted.
 *
 * Unconditional, and it dismisses as well as cancels. Cancelling only reaches a
 * request that has not fired yet; a bell that already rang sits in the shade
 * saying rest is over for a timer the user has since skipped, and tapping it
 * later reopens the app on a set they finished. The two calls together are what
 * "there is no rest notification" actually means.
 */
export async function cancelRestNotification(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID);
  } catch {
    // Nothing pending under that id; the dismissal below still has work to do.
  }

  try {
    await Notifications.dismissNotificationAsync(REST_NOTIFICATION_ID);
  } catch {
    // Nothing delivered under that id either. Both halves are best-effort.
  }
}

/**
 * Clears a bell left behind by a process that no longer exists.
 *
 * Killing the app during rest leaves the scheduled notification alive; if the
 * countdown behind it did not survive (an expired deadline restores as idle,
 * see `store/timer`), the alert would fire mid-set for nothing. This is called
 * from the active workout screen, next to the permission prompt, rather than at
 * launch. Asking in context is a deliberate decision, and a sweep at bootstrap
 * would drag notification setup back to app start where it was refused.
 *
 * Safe to call at any time: a rest period that is genuinely still running keeps
 * its notification.
 */
export async function sweepRestNotifications(): Promise<void> {
  const { restEndsAt } = useTimer.getState();
  if (restEndsAt !== null && restEndsAt > Date.now()) return;

  await cancelRestNotification();
}
