/**
 * The receiving half of the weigh-in reminder.
 *
 * `./weigh-in` posts a notification with a text field in it; this is what
 * happens when someone types into that field, or taps the notification instead.
 * It renders nothing and is mounted at the root, for the same reason
 * `WorkoutNotice` is: a notification response can arrive at any moment,
 * including the moment the app is launched by one, and it must not depend on
 * which screen happens to be up.
 *
 * ## Why both a listener and a one-shot read
 *
 * `addNotificationResponseReceivedListener` covers a response that arrives
 * while this component is mounted. It does not cover the response that *caused*
 * the launch: that one was delivered before any JS existed to hear it, and
 * `getLastNotificationResponse` is where the native side parked it. Handling
 * only the first loses every cold start; handling only the second loses every
 * response to an app already running. Both, deduplicated, is the whole story.
 *
 * ## Why it can refuse a reading
 *
 * The shade has no validation, no unit label beside the cursor and no second
 * chance. "82.4", "82,4" and "82.4 kg" are all the same intent and all get
 * filed; "eighty two" and "824" are not, and a silent drop there is worse than
 * no feature, because the user has every reason to believe it worked. So a
 * rejection posts a notification of its own, carrying the same field, which
 * turns a lost reading into a retry.
 */

import {
  formatMeasurementValue,
  fromDisplayMeasurementValue,
  isPlausibleMeasurement,
  measurementRange,
  trimZeros,
  type MeasurementUnitPreferences,
} from '@lift/shared';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

import { haptics } from '@/features/feedback/haptics';
import { recordBodyweight } from '@/features/measurements/repository';
import { useSettings } from '@/store/settings';

import { getNotifications } from './module';
import { WEIGH_IN_REMINDER_TYPE } from './presentation';
import {
  LOG_WEIGHT_ACTION,
  WEIGH_IN_CATEGORY_ID,
  refreshWeighInReminder,
} from './weigh-in';

/**
 * Responses already acted on, keyed by delivery.
 *
 * The scheduled request keeps one fixed identifier across every day it fires,
 * so the request id alone would suppress every reading after the first. The
 * delivery timestamp is what makes two mornings two events. Action identifier
 * included because tapping the body and submitting the field are different
 * things the user can do to the same delivery.
 *
 * Module scope rather than a ref: a cold-start response is read once, and a
 * remount of this component (a theme change re-rendering the tree, a fast
 * refresh in development) must not file it a second time.
 */
const handled = new Set<string>();

type NotificationResponse = Parameters<
  Parameters<
    NonNullable<ReturnType<typeof getNotifications>>['addNotificationResponseReceivedListener']
  >[0]
>[0];

/**
 * Whether there is a navigator to navigate, and the route waiting on one.
 *
 * `WeighInResponder` is a sibling of the `Stack` rather than a screen inside
 * it, and sibling effects fire in tree order, so its mount effect runs a beat
 * before the router has a root. A cold start caused by *tapping* the reminder
 * arrives on exactly that path, and calling `router.navigate` there raises
 * "attempted to navigate before mounting the Root Layout component" instead of
 * opening a screen. So the route is parked here and replayed once the key
 * exists, which on every other launch is already true by the first render and
 * costs nothing.
 *
 * Module scope rather than component state, and deliberately: a `setState`
 * inside the effect that flushes this would be a cascading render, and there is
 * exactly one of these components mounted for the life of the process.
 *
 * Only the routing half waits. A weight typed into the notification is filed
 * without consulting either of these: it writes to a table, and a table does
 * not need a navigator.
 */
let navigatorReady = false;
let pendingLog: string | null = null;

export function WeighInResponder() {
  const rootState = useRootNavigationState();
  const navigationReady = Boolean(rootState?.key);

  useEffect(() => {
    navigatorReady = navigationReady;
    if (!navigationReady) return;

    if (pendingLog !== null) {
      const log = pendingLog;
      pendingLog = null;
      goToBodyweight(log);
    }

    return () => {
      navigatorReady = false;
    };
  }, [navigationReady]);

  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleResponse(response);
    });

    /*
     * The response that launched the app, if there was one.
     *
     * Cleared as soon as it is taken, which is what stops it from being
     * re-handled the next time anything reads it: without the clear, a routing
     * decision made at launch is re-made on every subsequent read of the same
     * stale value.
     */
    const launch = Notifications.getLastNotificationResponse();
    if (launch) {
      void handleResponse(launch).finally(() => {
        Notifications.clearLastNotificationResponse();
      });
    }

    return () => subscription.remove();
  }, []);

  return null;
}

/**
 * The bodyweight chart, with its entry sheet open.
 *
 * `navigate` rather than `push`, so a second tap returns to the chart already
 * on the stack instead of stacking a copy of it behind the first.
 */
function goToBodyweight(log: string): void {
  router.navigate({ pathname: '/measurement/[kind]', params: { kind: 'bodyweight', log } });
}

/** Goes now, or as soon as there is a navigator. See `navigatorReady`. */
function requestNavigation(log: string): void {
  if (navigatorReady) goToBodyweight(log);
  else pendingLog = log;
}

async function handleResponse(response: NotificationResponse): Promise<void> {
  // Every other notification this app posts has its own handling, or none.
  if (response.notification.request.content.data?.type !== WEIGH_IN_REMINDER_TYPE) return;

  const key = `${response.notification.date}:${response.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);

  const typed = response.userText?.trim();

  /*
   * Tapping the body, or the action button on a platform that decided not to
   * show the field. Nothing to file, so open the place where filing it is one
   * number away, with the sheet already up.
   *
   * The delivery timestamp is what the route's `log` param carries, rather than
   * a constant flag: the screen re-opens the sheet when that value changes, and
   * two taps on two different mornings have to count as two requests to log
   * something.
   */
  if (response.actionIdentifier !== LOG_WEIGHT_ACTION || !typed) {
    requestNavigation(String(response.notification.date));
    return;
  }

  const { weightUnit, measurementUnit } = useSettings.getState();
  const prefs: MeasurementUnitPreferences = { weightUnit, measurementUnit };

  const display = parseTypedWeight(typed);
  const stored = display === null ? null : fromDisplayMeasurementValue('bodyweight', display, prefs);

  if (stored === null || !isPlausibleMeasurement('bodyweight', stored)) {
    await postRetry(typed, prefs);
    return;
  }

  await recordBodyweight(stored);
  haptics.logged();

  // The reminder quotes the last reading, and the reading it quotes is now this
  // one. Nothing else in this flow opens the app, so if this did not run the
  // body would keep naming a figure the user has since replaced.
  await refreshWeighInReminder();
}

/**
 * A number out of whatever the shade's keyboard produced.
 *
 * Deliberately forgiving about what surrounds it: people type the unit, and a
 * comma decimal is what half the world's keypads emit. Deliberately strict
 * about what it *is*: exactly one number, so "82 or 83" is a question rather
 * than a reading and gets bounced back rather than filed as 82.
 */
function parseTypedWeight(raw: string): number | null {
  const matches = raw.replace(',', '.').match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length !== 1) return null;

  const value = Number(matches[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Says the reading was not understood, and offers the field again.
 *
 * Posted immediately rather than scheduled: `null` is the trigger that means
 * now, and this is a reply to something the user did a second ago. It carries
 * the same category and the same type marker on purpose, so the retry is typed
 * into the same kind of field the first attempt was and comes back through
 * `handleResponse` like any other reading. A second bad reading posts a second
 * reply, which is not a loop: every round of it needs the user to type
 * something new, and stopping after one would leave them with a keyboard and no
 * way to correct a typo.
 */
async function postRetry(typed: string, prefs: MeasurementUnitPreferences): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  const range = measurementRange('bodyweight', prefs);
  const example = trimZeros(
    formatMeasurementValue('bodyweight', 82, prefs, { withUnit: false }),
  );

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Couldn't read that weight",
        body: `"${typed}" is not a weight between ${trimZeros(
          range.min.toFixed(0),
        )} and ${trimZeros(range.max.toFixed(0))} ${prefs.weightUnit}. Try just the number, like ${example}.`,
        categoryIdentifier: WEIGH_IN_CATEGORY_ID,
        data: { type: WEIGH_IN_REMINDER_TYPE },
      },
      trigger: null,
    });
  } catch {
    // No permission, or no channel. The reading is lost either way; Home says
    // there is none for today, which is the backstop for every path here.
  }
}
