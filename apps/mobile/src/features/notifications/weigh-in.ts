/**
 * The daily weigh-in reminder, and the text field attached to it.
 *
 * The gym reminder next door only has to say a thing. This one has to *take* a
 * thing, which is the whole point of it: a weigh-in is worth something only if
 * it is taken at the same hour every day, and the reliable way to lose that
 * habit is for logging the number to cost a launch, two taps and a keyboard.
 * So the notification carries a `textInput` action: the reading is typed in the
 * shade and filed without the app ever coming forward.
 *
 * ## Where the reading is filed
 *
 * Not here. This module schedules and describes; `./weigh-in-responder`
 * receives the response and writes it, because writing means the database, and
 * a module the settings screen imports to flip a switch should not drag the
 * repository in behind it.
 *
 * ## The one case that drops
 *
 * `opensAppToForeground: false` is what buys the app-stays-closed behaviour,
 * and on Android it comes with a documented hole: if the process has been fully
 * killed, `ExpoHandlingDelegate` has no JS listeners registered and the response
 * goes nowhere. The alternative is foregrounding the app every morning to save
 * one number, which is the cost this feature exists to remove. So the tradeoff
 * is taken deliberately and covered from the other side: tapping the
 * notification body always works, and Home says plainly when today has no
 * reading, so a dropped response is visible rather than silent.
 */

import { formatMeasurementValue, parseClockTime, type MeasurementUnitPreferences } from '@lift/shared';
import { Platform } from 'react-native';

import { useSettings } from '@/store/settings';

import { getNotifications } from './module';
import { configureNotificationHandler, WEIGH_IN_REMINDER_TYPE } from './presentation';

const ANDROID_CHANNEL_ID = 'weigh-in-reminder';

/** Fixed, so re-scheduling replaces rather than stacks. Same as `./reminder`. */
const WEIGH_IN_NOTIFICATION_ID = 'weigh-in-daily';

/**
 * The category the action button hangs off.
 *
 * iOS reads this from `content.categoryIdentifier` and Android from the same
 * field via `ExpoNotificationBuilder`, so one registration covers both. It has
 * to be registered before the notification is scheduled, not merely before it
 * fires: the Android builder resolves the category out of its own store when it
 * posts, and iOS matches on delivery.
 */
export const WEIGH_IN_CATEGORY_ID = 'weigh-in';

/** The identifier the response carries back when the field is submitted. */
export const LOG_WEIGHT_ACTION = 'weigh-in.log';

/** Same three outcomes, and the same reasons, as `./reminder`. */
export type WeighInPermission = 'granted' | 'denied' | 'unsupported';

/**
 * HIGH, like the gym reminder.
 *
 * A weigh-in reminder that arrives silently is one you read at lunchtime, by
 * which point the reading it wanted is no longer comparable with yesterday's.
 */
async function ensureChannel(
  Notifications: NonNullable<ReturnType<typeof getNotifications>>,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Weigh-in Reminder',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Registers the action, in the unit the user actually types in.
 *
 * The placeholder names the unit rather than leaving it implied, because the
 * shade is the one place in the app with no label beside the field and no way
 * to correct a reading that went in as pounds. Re-registered on every schedule
 * so a unit switch in Settings reaches the notification too.
 */
async function ensureCategory(
  Notifications: NonNullable<ReturnType<typeof getNotifications>>,
  prefs: MeasurementUnitPreferences,
): Promise<void> {
  await Notifications.setNotificationCategoryAsync(WEIGH_IN_CATEGORY_ID, [
    {
      identifier: LOG_WEIGHT_ACTION,
      buttonTitle: 'Log weight',
      textInput: {
        submitButtonTitle: 'Log',
        placeholder: `Weight in ${prefs.weightUnit}`,
      },
      options: {
        // The entire feature. See the note at the top of this file for what it
        // costs on a killed Android process and why it is still the right side
        // of the trade.
        opensAppToForeground: false,
      },
    },
  ]);
}

/** Requests permission, prepares the Android channel and registers the action. */
export async function prepareWeighInNotifications(): Promise<WeighInPermission> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return 'unsupported';

  await ensureChannel(Notifications);

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';

  // The OS will not show the dialog twice, so a retry is a call that always
  // resolves to denied.
  if (!existing.canAskAgain) return 'denied';

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

/**
 * What the notification says under its title.
 *
 * The last reading, because that is the number the user is about to type a
 * variation on, and because a reminder that states nothing is one you swipe
 * away without reading. Scheduled content is fixed at schedule time, so this
 * goes stale unless something re-arms it: `syncWeighInReminder` does on every
 * launch, and `./weigh-in-responder` does after each reading it files, which
 * together cover every way the figure changes.
 */
function reminderBody(): string {
  const { bodyweightKg, weightUnit, measurementUnit } = useSettings.getState();
  if (bodyweightKg == null) return 'Type your weight here to log it.';

  const last = formatMeasurementValue('bodyweight', bodyweightKg, {
    weightUnit,
    measurementUnit,
  });
  return `Last: ${last}. Type today's to log it.`;
}

/**
 * Schedules the daily weigh-in, replacing any request already pending.
 *
 * Returns whether anything is now scheduled, so a caller turning the switch on
 * can decline to record it as on.
 *
 * @param time Wall-clock time as `"HH:mm"`.
 */
export async function scheduleWeighInReminder(time: string): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  // Range-checked rather than merely parsed: an out-of-range hour throws a
  // `RangeError` from inside the library.
  const parsed = parseClockTime(time);
  if (!parsed) return false;

  const { weightUnit, measurementUnit } = useSettings.getState();

  await cancelWeighInReminder();

  try {
    await ensureCategory(Notifications, { weightUnit, measurementUnit });

    await Notifications.scheduleNotificationAsync({
      identifier: WEIGH_IN_NOTIFICATION_ID,
      content: {
        title: 'Morning weigh-in',
        body: reminderBody(),
        categoryIdentifier: WEIGH_IN_CATEGORY_ID,
        // Read by `./presentation`, which otherwise suppresses every alert
        // while the app is foregrounded.
        data: { type: WEIGH_IN_REMINDER_TYPE },
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
    // and the call. The setting is unaffected and re-applies on the next
    // launch; see `syncWeighInReminder`.
    return false;
  }
}

/** Cancels the pending weigh-in reminder. */
export async function cancelWeighInReminder(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(WEIGH_IN_NOTIFICATION_ID);
  } catch {
    // Nothing pending under that id.
  }
}

/**
 * Makes the OS agree with the stored preference. Called once at launch.
 *
 * The same repair job `syncGymReminder` does, plus one this reminder needs and
 * that one does not: it re-writes the notification's body, which quotes the
 * last reading and would otherwise keep quoting whatever it was on the day the
 * switch was flipped.
 *
 * Never prompts. Launch is the wrong moment to ask for a permission, and a user
 * who has since revoked it has said what they think.
 */
export async function syncWeighInReminder(enabled: boolean, time: string): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  if (!enabled) {
    await cancelWeighInReminder();
    return;
  }

  configureNotificationHandler();

  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) return;

  await ensureChannel(Notifications);
  await scheduleWeighInReminder(time);
}

/**
 * Re-arms the reminder so its body quotes the reading just filed.
 *
 * A no-op when the reminder is off, which is the common case, so it is safe to
 * call from anywhere a bodyweight is recorded.
 */
export async function refreshWeighInReminder(): Promise<void> {
  const { weighInReminderEnabled, weighInReminderTime } = useSettings.getState();
  if (!weighInReminderEnabled) return;

  await scheduleWeighInReminder(weighInReminderTime);
}
