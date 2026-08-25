/**
 * The app's single foreground-presentation policy.
 *
 * `setNotificationHandler` is global and last-write-wins, so this cannot live
 * inside whichever feature happens to configure notifications first: the rest
 * timer used to own it, and an ongoing workout notification registered later
 * would have silently inherited "hide me" and never appeared in the shade.
 *
 * Only consulted while the app is foregrounded. A delivery that arrives while
 * the app is backgrounded is presented by the system using the channel's own
 * settings and never reaches this function.
 */

import { useSettings } from '@/store/settings';

import { getNotifications } from './module';

/** Marks a notification as the persistent workout status, not an alert. */
export const ONGOING_WORKOUT_TYPE = 'workout-ongoing';

/**
 * Marks the rest timer's "rest complete" bell.
 *
 * The one delivery that may be asked to make a sound while showing nothing at
 * all. See `shouldPlaySound` below for why that is a real presentation and not
 * a contradiction.
 */
export const REST_BELL_TYPE = 'rest-bell';

/**
 * Marks the daily gym reminder.
 *
 * It is the one scheduled alert with no on-screen counterpart. The rest bell
 * shows nothing in the foreground because the timer bar is already on screen;
 * nothing in the app says "it is five o'clock, go to the gym", so this is the
 * only banner of the three. Without this marker the reminder was silently dropped
 * whenever it happened to fire while the app was open, which is exactly when a
 * user testing the feature would look for it.
 */
export const GYM_REMINDER_TYPE = 'gym-reminder';

let configured = false;

export function configureNotificationHandler(): void {
  if (configured) return;

  // Left unset rather than marked configured: if this is ever reached in an
  // environment that gains the module later, the handler still gets installed.
  const Notifications = getNotifications();
  if (!Notifications) return;

  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const type = notification.request.content.data?.type;
      const isOngoing = type === ONGOING_WORKOUT_TYPE;
      const isReminder = type === GYM_REMINDER_TYPE;

      /*
       * The rest bell rings here only when the user asked for a system route,
       * and it rings with nothing shown.
       *
       * That combination is deliberate on both platforms and is the entire
       * mechanism behind the "Notification" and "Alarm" settings. Sound with no
       * banner and no shade entry is a presentation option on iOS, and on
       * Android it takes `expo-notifications` down a path that plays the
       * channel's tone through the ringtone stream and posts nothing. Either
       * way the sound comes from the OS, which is what puts it on the ring or
       * alarm slider and out of the handset's speaker, rather than from
       * `expo-audio`, which can only ever be the music slider and whatever it
       * is paired to.
       *
       * On `media` this stays false and `RestCues` plays the bell itself, which
       * is what the app did before any of this existed.
       */
      const settings = useSettings.getState();
      const ringsRestBell =
        type === REST_BELL_TYPE &&
        settings.soundEnabled &&
        settings.restTimerSoundOutput !== 'media';

      return {
        // The gym reminder is the only banner. The rest bell is a sound and
        // nothing else, and the workout status is a status line, not news; a
        // reminder to come in is news, and nothing on screen says it.
        shouldShowBanner: isReminder,
        // The ongoing notification is the one thing that *must* stay in the
        // shade while the app is open. Being visible there is its entire job.
        // Everything else is redundant with the UI the user is looking at.
        shouldShowList: isOngoing || isReminder,
        shouldPlaySound: isReminder || ringsRestBell,
        shouldSetBadge: false,
      };
    },
  });
}
