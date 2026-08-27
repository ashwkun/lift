/**
 * The two permissions that decide whether the rest bell is on time.
 *
 * `expo-notifications` schedules every local alert through `AlarmManager`, and
 * it picks which kind in `ExpoSchedulingDelegate.setupAlarm`:
 *
 *   if (SDK_INT < S || alarmManager.canScheduleExactAlarms())
 *     AlarmManagerCompat.setExactAndAllowWhileIdle(...)
 *   else
 *     AlarmManagerCompat.setAndAllowWhileIdle(...)
 *
 * An app that declares neither permission takes the second branch on Android 12
 * and up, and that branch is a *request* rather than a time. The system batches
 * it against whatever else is waiting, and with the screen off it holds it until
 * the device next wakes for its own reasons. A two-minute rest ended in silence
 * and the bell arrived on the lock screen, which is where this app was before
 * this file existed.
 *
 * Two permissions rather than one because the platform changed its mind at 33.
 * `SCHEDULE_EXACT_ALARM` is the Android 12 spelling, granted at install and
 * revocable by the user, and `USE_EXACT_ALARM` is the Android 13 one, granted
 * always and not revocable. `canScheduleExactAlarms()` returns true for either,
 * so the cap on the first is what keeps a phone from listing an "Alarms &
 * reminders" switch that is off while the bell rings on time regardless.
 *
 * A config plugin rather than `expo.android.permissions` in app.json, which
 * writes a bare `android:name` and has nowhere to put the `maxSdkVersion`.
 *
 * The one thing this costs: `USE_EXACT_ALARM` is a Play Store declaration, for
 * apps whose core function is an alarm or a timer. Lift ships as an APK from a
 * GitHub release, so nothing asks today, and a rest timer is the case the
 * policy describes if it ever does.
 */

import { withAndroidManifest, type AndroidConfig, type ConfigPlugin } from 'expo/config-plugins';

const SCHEDULE_EXACT_ALARM = 'android.permission.SCHEDULE_EXACT_ALARM';
const USE_EXACT_ALARM = 'android.permission.USE_EXACT_ALARM';

/**
 * `android:maxSdkVersion` is not in the typing, which covers `android:name` and
 * `tools:node`. Widened here rather than cast at the assignment, so the entries
 * below stay readable as the XML they become.
 */
type PermissionAttributes = AndroidConfig.Manifest.ManifestUsesPermission['$'] & {
  'android:maxSdkVersion'?: string;
};

const EXACT_ALARM_PERMISSIONS: { $: PermissionAttributes }[] = [
  { $: { 'android:name': USE_EXACT_ALARM } },
  // Android 13 replaced this one, so it is dead weight from 33 up and the
  // system settings entry it produces there is a switch that governs nothing.
  { $: { 'android:name': SCHEDULE_EXACT_ALARM, 'android:maxSdkVersion': '32' } },
];

const withExactAlarms: ConfigPlugin = (config) =>
  withAndroidManifest(config, (config) => {
    const { manifest } = config.modResults;

    // Filtered rather than appended blind: a prebuild runs this over a manifest
    // that may already carry them, and two identical `uses-permission` lines
    // are a manifest merger failure rather than a duplicate that is ignored.
    const others = (manifest['uses-permission'] ?? []).filter(
      (permission) =>
        permission.$['android:name'] !== USE_EXACT_ALARM &&
        permission.$['android:name'] !== SCHEDULE_EXACT_ALARM,
    );

    manifest['uses-permission'] = [...others, ...EXACT_ALARM_PERMISSIONS];

    return config;
  });

export default withExactAlarms;
