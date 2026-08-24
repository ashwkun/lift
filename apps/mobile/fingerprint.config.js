/**
 * What counts as a native change, for the purposes of `runtimeVersion`.
 *
 * `app.json` sets `runtimeVersion.policy` to `fingerprint`, so an install only
 * ever accepts an OTA update published under a fingerprint identical to its
 * own. That is the right policy: it is what makes it impossible to push a JS
 * bundle that needs a native module the installed APK does not have.
 *
 * It was also, until this file existed, silently switching OTA off at every
 * release. The fingerprint hashes the resolved Expo config, and `version` is
 * part of that config, so bumping `app.json` from 0.9.0 to 0.10.0 changed the
 * fingerprint even though nothing native moved. The three shipped releases each
 * landed on their own runtime version:
 *
 *   0.8.0   670a00f3…      0.9.0   31f44b72…      0.10.0   5ce7b7c0…
 *
 * A phone running the 0.9.0 APK asks the server for `31f44b72…`, the 0.10.0
 * bundle was published under `5ce7b7c0…`, and the server correctly answers that
 * it has nothing. The app reports that as "you are on the latest version",
 * which is true of its runtime version and misleading about everything else.
 * Every release cut off every install that came before it.
 *
 * `ExpoConfigVersions` drops `version`, `android.versionCode` and
 * `ios.buildNumber` from the hash, which is exactly the set of fields that
 * change on a release and cannot affect the native build. Everything else the
 * fingerprint watches is left alone: a new config plugin, a new Expo module, a
 * permission, an icon, an SDK bump all still produce a new runtime version and
 * still correctly require a fresh APK.
 *
 * One consequence worth knowing, because it looks like the fix not working:
 * adding this file *also* changes the fingerprint. The 0.9.0 and 0.10.0 builds
 * already in the wild stay stranded and cannot be rescued by an update, since
 * reaching them is the thing that is broken. The first build cut after this
 * lands is the one that starts receiving OTA updates across version bumps.
 *
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  sourceSkips: ['ExpoConfigVersions'],
};
