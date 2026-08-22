/**
 * Guarded access to `expo-notifications`.
 *
 * Since SDK 53 the Android build of Expo Go throws from this module's own
 * initialiser: not from the push APIs, which this app never calls. A static
 * `import` is therefore enough to fail every module above it in the graph, and
 * because `_layout.tsx` reaches two of them the whole route tree collapses into
 * "missing the required default export" rather than degrading one feature.
 *
 * So the require is deferred behind the environment check and never evaluated
 * in Expo Go at all. Notifications are the only thing lost there; a dev build
 * and a store build load the real module and behave exactly as before.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

/**
 * False in Expo Go on Android, and false on the web.
 *
 * `StoreClient` is the execution environment Expo Go reports; a dev build
 * reports `Bare` and a store build `Standalone`. Expo Go on iOS still carries a
 * working module, so the platform half of this is not redundant.
 *
 * The web case is a different failure with the same handling. `expo-notifications`
 * does load in a browser, so nothing throws at import, but the API this app
 * actually uses is `scheduleNotificationAsync`, and scheduling a *local* alert
 * for a future time has no web implementation at all: the browser equivalent
 * needs a service worker and a push subscription, neither of which a static
 * export has. Calling it raises an `UnavailabilityError` from inside the rest
 * timer, on every set.
 *
 * Naming web here instead means the desktop build takes the same path as a
 * phone with the permission denied, which is a path every call site already
 * handles. Nothing is silently lost: the rest countdown, its bell (`RestCues`,
 * which is `expo-audio` and works fine in a tab) and the docked timer bar are
 * all on-screen anyway. The one thing a browser cannot do is tell you rest is
 * over once the tab is in the background, and on a machine where the user is
 * reading and planning rather than lifting, that is the least load-bearing
 * feature in the app.
 */
export const notificationsAvailable =
  Platform.OS !== 'web' &&
  (Platform.OS !== 'android' ||
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient);

let cached: NotificationsModule | null = null;

/**
 * The module, or `null` where it cannot be loaded.
 *
 * Callers treat `null` exactly as they already treat a denied permission: the
 * user gets no notification and the workout is otherwise unaffected. That path
 * existed at every call site before this, which is why nothing here needs to
 * throw or surface an error of its own.
 */
export function getNotifications(): NotificationsModule | null {
  if (!notificationsAvailable) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached ??= require('expo-notifications') as NotificationsModule;
  return cached;
}
