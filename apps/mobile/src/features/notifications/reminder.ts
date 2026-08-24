/**
 * The daily "time to lift" reminder.
 *
 * The one notification in the app that is neither tied to a running workout nor
 * to a rest period: it fires at a wall-clock time the user picked, on a day
 * they may not open the app at all, which is the whole point of it.
 *
 * ## Why it never fired
 *
 * The trigger used to be `{ hour, minute, repeats: true, channelId }` with the
 * type stripped by an `as any`. That object is not a daily trigger to
 * `expo-notifications`. `parseTrigger` matches on the `type` field, finds none,
 * and falls through to its last branch, which on Android builds
 * `{ type: 'channel', channelId }`: the same shape `./workout` uses on purpose
 * to mean *deliver now, on this channel*. So the reminder arrived the instant
 * the switch was flipped, once, and never again. On iOS there is no channel to
 * fall through to, so `hasValidTriggerObject` rejected the object outright and
 * `scheduleNotificationAsync` threw into a floating promise: nothing scheduled,
 * nothing said.
 *
 * `SchedulableTriggerInputTypes.DAILY` is the shape that means what was
 * intended, and it is the same discriminated form `./rest` already uses.
 */

import { parseClockTime } from '@lift/shared';
import { Platform } from 'react-native';

import { getNotifications } from './module';
import { configureNotificationHandler, GYM_REMINDER_TYPE } from './presentation';

const ANDROID_CHANNEL_ID = 'gym-reminder';

/**
 * Fixed, so re-scheduling replaces the pending request rather than adding a
 * second one, and so cancelling works from a cold start where a handle from the
 * previous process is gone but the request the OS holds is not. The same
 * reasoning as `REST_NOTIFICATION_ID` in `./rest`.
 */
const REMINDER_NOTIFICATION_ID = 'gym-reminder-daily';

/**
 * Why the switch did not turn on.
 *
 * A boolean could not tell those apart, and the two need different words: a
 * denied permission is fixed in system settings, and Expo Go is fixed by
 * installing a real build. Both used to leave the toggle silently snapping back.
 */
export type ReminderPermission = 'granted' | 'denied' | 'unsupported';

/**
 * The channel the reminder posts to. A no-op off Android.
 *
 * HIGH importance, matching the rest timer rather than the ongoing-workout
 * status line. A reminder that arrives silently at the bottom of the shade is
 * one the user finds at bedtime, which is the failure it exists to prevent.
 */
async function ensureChannel(
  Notifications: NonNullable<ReturnType<typeof getNotifications>>,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Gym Reminder',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** Requests permission and prepares the Android channel. */
export async function prepareReminderNotifications(): Promise<ReminderPermission> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return 'unsupported';

  await ensureChannel(Notifications);

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';

  // Don't re-prompt once refused. The OS will not show the dialog a second time
  // anyway, so a retry is a call that always resolves to denied.
  if (!existing.canAskAgain) return 'denied';

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

/**
 * Schedules the daily reminder, replacing any request already pending.
 *
 * Returns whether anything is now scheduled, so a caller that is turning the
 * feature on can decline to record it as on.
 *
 * @param time Wall-clock time as `"HH:mm"`.
 */
export async function scheduleGymReminder(time: string): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  // Range-checked, not merely parsed: an out-of-range hour makes
  // `scheduleNotificationAsync` throw a `RangeError` from inside the library.
  const parsed = parseClockTime(time);
  if (!parsed) return false;

  await cancelGymReminder();

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_NOTIFICATION_ID,
      content: {
        title: 'Time to lift',
        body: 'Your gym time is here. Go and get it.',
        // Read by `./presentation`, which otherwise suppresses every alert
        // while the app is foregrounded.
        data: { type: GYM_REMINDER_TYPE },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: parsed.hour,
        minute: parsed.minute,
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
      },
    });

    return true;
  } catch {
    // A channel the user disabled, or a permission revoked between the check
    // and the call. The setting itself is unaffected and re-applies on the next
    // launch; see `syncGymReminder`.
    return false;
  }
}

/** Cancels the pending reminder. */
export async function cancelGymReminder(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_NOTIFICATION_ID);
  } catch {
    // Nothing pending under that id.
  }
}

/**
 * Makes the OS agree with the stored preference. Called once at launch.
 *
 * A daily trigger survives a reboot on both platforms, so this is not the thing
 * that keeps the reminder alive day to day. It is what repairs the cases where
 * the request is gone but the preference says it should be there: a user who
 * force-stopped the app on Android (which drops its alarms), a restore onto a
 * new device, and above all anyone who had the switch on while the trigger was
 * the broken one described at the top of this file. Those users have
 * `gymReminderEnabled: true` persisted and nothing scheduled, and no amount of
 * re-opening the settings screen would have fixed it.
 *
 * Never prompts. Launch is the wrong moment to ask for a permission, and a user
 * who has since revoked it has said what they think. It only re-arms a
 * permission that is already granted.
 */
export async function syncGymReminder(enabled: boolean, time: string): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  if (!enabled) {
    await cancelGymReminder();
    return;
  }

  configureNotificationHandler();

  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) return;

  await ensureChannel(Notifications);
  await scheduleGymReminder(time);
}
