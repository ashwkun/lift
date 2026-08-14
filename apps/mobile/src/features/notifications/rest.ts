/**
 * Local notification for the rest timer.
 *
 * The timer itself is driven by an absolute deadline in JS, but that only fires
 * while the app is foregrounded. A scheduled local notification is what actually
 * tells the user rest is over once they've pocketed their phone.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'rest-timer';

let configured = false;
let scheduledId: string | null = null;

/**
 * Shows the alert even when the app is in the foreground — the default is to
 * suppress it, which would mean no cue at all for someone staring at the
 * logging screen.
 */
function configureHandler() {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Requests permission and prepares the Android channel.
 * Returns whether notifications can actually be delivered.
 */
export async function prepareRestNotifications(): Promise<boolean> {
  configureHandler();

  if (Platform.OS === 'android') {
    // Android requires a channel before anything can be posted; importance
    // HIGH is what allows a heads-up banner over the workout screen.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Rest Timer',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      sound: 'default',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  // Don't re-prompt if the user has already said no — the OS won't show the
  // dialog twice anyway, and asking mid-workout is intrusive.
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Schedules the "rest over" alert, replacing any previously scheduled one. */
export async function scheduleRestNotification(
  seconds: number,
  exerciseName?: string,
): Promise<void> {
  if (seconds <= 0) return;

  await cancelRestNotification();

  scheduledId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rest complete',
      body: exerciseName ? `Time for your next set of ${exerciseName}.` : 'Time for your next set.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
    },
  });
}

/** Cancels the pending alert — called when rest is skipped or adjusted. */
export async function cancelRestNotification(): Promise<void> {
  if (!scheduledId) return;

  const id = scheduledId;
  scheduledId = null;

  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or dismissed; nothing to clean up.
  }
}
