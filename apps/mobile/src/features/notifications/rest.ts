/**
 * Local notification for the rest timer.
 *
 * The timer itself is driven by an absolute deadline in JS, but that only fires
 * while the app is foregrounded. A scheduled local notification is what actually
 * tells the user rest is over once they've pocketed their phone.
 *
 * While the app *is* foregrounded the notification never shows itself: the
 * timer bar is on screen, and covering the workout with a banner describing
 * something the user is looking at helps nobody.
 *
 * It may still *ring* there, and on every route but `media` that is the point of
 * it. A foregrounded delivery with no banner and no shade entry is the one way
 * to get a sound out of the OS rather than out of the app, which is what puts it
 * on the ring or alarm slider instead of the music one. `RestCues` steps aside
 * when this is going to happen: see `systemRestBellPending`.
 */

import { Platform } from 'react-native';

import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';

import { getNotifications } from './module';
import { configureNotificationHandler, REST_BELL_TYPE } from './presentation';

/**
 * One channel per audio route, because a channel cannot be re-pointed.
 *
 * An Android channel's sound *and* its audio attributes are fixed at creation.
 * Passing new ones for an id that already exists is silently ignored, so the
 * only way to move a user onto a different route is a different id: `-v2` is
 * itself the second of these, from when the bell replaced the system tone.
 *
 * `standard` carries the default attributes, which is `USAGE_NOTIFICATION`: the
 * text-message slider. `alarm` is the same bell declared as an alarm, which is
 * the loudest thing a phone will play and the one route that reliably comes out
 * of the handset's own speaker with earbuds paired.
 *
 * Only the one in force exists at a time. Two channels both called "Rest timer"
 * in the system's notification settings is a list the user has to decode, and
 * whichever one they tuned would be the one the app was not using.
 */
const ANDROID_CHANNELS = {
  standard: 'rest-timer-v2',
  alarm: 'rest-timer-alarm',
} as const;

type ChannelKind = keyof typeof ANDROID_CHANNELS;

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
 * Whether the OS will actually deliver the bell, as far as we last knew.
 *
 * Written by `prepareRestNotifications`, which is the one place that asks. A
 * granted permission is not enough on its own and a denied one is not the only
 * way to lose the bell: Expo Go and the web build have no module to schedule
 * with either, and all three end in the same place, which is why this is one
 * flag rather than three questions.
 *
 * Starts false, so anything that reads it before the workout screen has had its
 * turn assumes the app has to make its own noise. That is the safe way round:
 * the failure is a bell played through the wrong speaker, not no bell at all.
 */
let deliverable = false;

/** Whether a bell is currently scheduled with the OS. */
let pending = false;

/** The channel `ensureRestChannel` last wrote, so it only writes on a change. */
let preparedChannel: string | null = null;

/**
 * Whether the sound at zero is the OS's job rather than the app's.
 *
 * True only when all three of the things that have to line up have lined up: the
 * user picked a system route, a bell is scheduled, and the OS is in a position
 * to deliver it. Any one of them missing and `RestCues` plays the bell itself,
 * which is the same bell through the music slider: quieter than intended, but
 * never nothing.
 *
 * The other half of this rule lives in `presentation.ts`, which is what makes a
 * foregrounded delivery ring instead of doing nothing. The two have to agree, or
 * the bell either doubles or vanishes.
 */
export function systemRestBellPending(): boolean {
  return pending && deliverable && useSettings.getState().restTimerSoundOutput !== 'media';
}

function channelKindFor(): ChannelKind {
  return useSettings.getState().restTimerSoundOutput === 'alarm' ? 'alarm' : 'standard';
}

/**
 * Creates the channel the current sound route needs, and retires the other one.
 *
 * Cheap after the first call for a given route, and called again on every
 * schedule rather than only at prepare time: the route is a setting, the user
 * can change it mid-rest, and the channel named in the trigger below has to
 * exist by the time the OS reaches for it.
 *
 * Returns the channel id, or `undefined` off Android, which is what
 * `scheduleNotificationAsync` wants for a platform that has no channels.
 */
async function ensureRestChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;

  const Notifications = getNotifications();
  if (!Notifications) return undefined;

  const kind = channelKindFor();
  const id = ANDROID_CHANNELS[kind];
  if (preparedChannel === id) return id;

  // Android requires a channel before anything can be posted; importance
  // HIGH is what allows a heads-up banner over the lock screen.
  await Notifications.setNotificationChannelAsync(id, {
    name: 'Rest Timer',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    sound: SOUND_FILE,
    // The bell is the point of the alert, so it should not be muted by Do Not
    // Disturb's default bypass rules any more than an alarm would be.
    bypassDnd: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    ...(kind === 'alarm'
      ? {
          /*
           * The whole of the "Alarm" setting, in four lines.
           *
           * `USAGE_ALARM` moves the bell onto the alarm slider and onto the
           * routing policy that goes with it, which is the one that treats the
           * handset speaker as a destination even when something is paired over
           * Bluetooth. `SONIFICATION` is the honest content type for a cue that
           * is a signal rather than music or speech.
           */
          audioAttributes: {
            usage: Notifications.AndroidAudioUsage.ALARM,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
          },
        }
      : {}),
  });

  // Everything this app is not currently posting on, so the system settings
  // list holds one "Rest Timer" rather than one per route the user has tried.
  // The pre-bell channel is in here for the same reason it always was.
  const retired = [
    LEGACY_ANDROID_CHANNEL_ID,
    ...Object.values(ANDROID_CHANNELS).filter((channel) => channel !== id),
  ];

  for (const channel of retired) {
    await Notifications.deleteNotificationChannelAsync(channel).catch(() => {});
  }

  preparedChannel = id;
  return id;
}

/**
 * Requests permission and prepares the Android channel.
 * Returns whether notifications can actually be delivered.
 */
export async function prepareRestNotifications(): Promise<boolean> {
  configureNotificationHandler();

  // Indistinguishable from a denied permission to every caller, which is the
  // point: the timer bar already renders the same way when this returns false.
  const Notifications = getNotifications();

  if (!Notifications) {
    deliverable = false;
    return false;
  }

  await ensureRestChannel();

  const existing = await Notifications.getPermissionsAsync();

  // Don't re-prompt if the user has already said no. The OS won't show the
  // dialog twice anyway, and asking mid-workout is intrusive.
  const granted =
    existing.granted ||
    (existing.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);

  deliverable = granted;
  return granted;
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

  const channelId = await ensureRestChannel();

  await Notifications.scheduleNotificationAsync({
    identifier: REST_NOTIFICATION_ID,
    content: {
      title: 'Rest complete',
      body: exerciseName ? `Time for your next set of ${exerciseName}.` : 'Time for your next set.',
      sound: SOUND_FILE,
      // Read back by the foreground handler, which has to tell this apart from
      // the ongoing workout line and the gym reminder to know whether it is the
      // one delivery that rings without showing anything.
      data: { type: REST_BELL_TYPE },
      // A rest timer is the one alert that is useless if it arrives late, so it
      // asks to break through Focus modes. iOS honours this only with the
      // time-sensitive entitlement and quietly downgrades to a normal alert
      // otherwise, which is the behaviour we'd have had anyway.
      ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId,
    },
  });

  pending = true;
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
  pending = false;

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
