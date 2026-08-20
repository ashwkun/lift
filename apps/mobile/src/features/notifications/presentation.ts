/**
 * The app's single foreground-presentation policy.
 *
 * `setNotificationHandler` is global and last-write-wins, so this cannot live
 * inside whichever feature happens to configure notifications first — the rest
 * timer used to own it, and an ongoing workout notification registered later
 * would have silently inherited "hide me" and never appeared in the shade.
 *
 * Only consulted while the app is foregrounded. A delivery that arrives while
 * the app is backgrounded is presented by the system using the channel's own
 * settings and never reaches this function.
 */

import { getNotifications } from './module';

/** Marks a notification as the persistent workout status, not an alert. */
export const ONGOING_WORKOUT_TYPE = 'workout-ongoing';

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
      const isOngoing = notification.request.content.data?.type === ONGOING_WORKOUT_TYPE;

      return {
        // Never a heads-up banner. The rest bell is already played in-app by
        // `RestCues`, and the workout status is a status line, not news.
        shouldShowBanner: false,
        // The ongoing notification is the one thing that *must* stay in the
        // shade while the app is open — being visible there is its entire job.
        // Everything else is redundant with the UI the user is looking at.
        shouldShowList: isOngoing,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}
