import { Platform } from 'react-native';

import { getNotifications } from './module';
import { configureNotificationHandler } from './presentation';

const ANDROID_CHANNEL_ID = 'gym-reminder';
const REMINDER_NOTIFICATION_ID = 'gym-reminder-daily';

/**
 * Requests permission and prepares the Android channel for reminders.
 */
export async function prepareReminderNotifications(): Promise<boolean> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Gym Reminder',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Schedules a daily reminder.
 * @param time String in "HH:mm" format
 */
export async function scheduleGymReminder(time: string): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  await cancelGymReminder();

  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  if (isNaN(hour) || isNaN(minute)) return;

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_NOTIFICATION_ID,
    content: {
      title: 'Time to lift!',
      body: 'Your scheduled gym time has arrived. Have a great workout!',
    },
    trigger: {
      hour,
      minute,
      repeats: true,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
    } as any,
  });
}

/**
 * Cancels the pending reminder.
 */
export async function cancelGymReminder(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_NOTIFICATION_ID);
  } catch {
    // Ignore
  }
}
