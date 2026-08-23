/**
 * One launcher icon per theme, and the switch the app throws to choose between
 * them.
 *
 * Android cannot recolour an app icon at runtime. The icon is a resource
 * compiled into the APK and named by the manifest, so "the icon follows the
 * theme" has to be built as: every theme's icon ships in the binary, each one
 * named by an `<activity-alias>` of its own, and exactly one alias is enabled at
 * a time. Enabling an alias is the only part that happens on the phone, and that
 * is what `modules/app-icon` does. Everything else is here.
 *
 * A config plugin rather than files in `android/`, for the reason
 * `modules/workout-live/index.ts` gives: `android/` is gitignored and
 * `pnpm prebuild` runs `expo prebuild --clean`, which deletes it. This runs on
 * every prebuild and puts it all back.
 *
 * ## What it writes
 *
 * For each theme in `LAUNCHER_ICONS`:
 *
 * - two colours in `values/colors.xml`;
 * - `mipmap-anydpi-v26/ic_launcher_<theme>.xml`, an adaptive icon whose
 *   background is the theme's colour and whose foreground is the app's own
 *   `ic_launcher_foreground` tinted with the theme's accent. The artwork is
 *   shared: the mark is a single flat colour on transparency, so a tint is the
 *   whole difference between one theme's icon and another's, and eight copies of
 *   the same webp at five densities would be ~40 files that all say the same
 *   thing;
 * - `mipmap-anydpi/ic_launcher_<theme>.xml`, the same two layers as a
 *   `layer-list`, for API 24 and 25. `minSdkVersion` is 24 and adaptive icons
 *   arrived in 26, so without this the resource has no value at all on those two
 *   releases and the launcher asks for an icon that cannot be resolved. It is
 *   the unmasked square those launchers drew anyway;
 * - an `<activity-alias>` naming that icon.
 *
 * And it takes MAIN/LAUNCHER off `MainActivity`.
 *
 * ## Why MainActivity stops being the launcher entry
 *
 * Because the alias that is showing has to be switchable, and `MainActivity` is
 * the one component that cannot be: every alias targets it, and the app has to
 * be able to start. So it keeps its `lift://` filter and its export, loses its
 * launcher filter, and the launcher entry becomes one of N aliases instead:
 * always exactly one enabled, never the activity itself. `expo run:android`
 * still launches it (`am start -n` names the component explicitly, and
 * `resolveLaunchProps` in @expo/cli falls back to `.MainActivity` when no
 * activity has a launcher filter), and a `lift://` link still resolves.
 *
 * The cost is paid once, by anyone upgrading from a build made before this
 * existed: their home screen shortcut points at `com.lift.app/.MainActivity`,
 * which is no longer a launcher component, so the shortcut stops working and
 * the app has to be dragged out of the drawer again. There is no version of
 * this feature that avoids that.
 */

/// <reference types="node" />
// The app has no Node typings by design (see `tsconfig.json`), and this one
// file is Node: it runs under `expo prebuild`, not on a phone. Referenced here
// rather than added to `types` so nothing in `src/` picks up `process` or
// `Buffer` as globals it can reach.
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AndroidConfig,
  withAndroidColors,
  withAndroidManifest,
  withDangerousMod,
  type ConfigPlugin,
} from 'expo/config-plugins';

// Explicit `.ts`, so Node's type stripping can load it during prebuild without
// a build step: the same arrangement `tsconfig.json` describes for the modules
// in @lift/shared, and why `allowImportingTsExtensions` is on.
import { DEFAULT_LAUNCHER_ICON, LAUNCHER_ICONS } from '../src/theme/launcher-icons.ts';

/**
 * Prefixes, and the one thing in this file the native side also knows.
 *
 * `modules/app-icon` finds the aliases by asking the package manager for every
 * component whose name starts with `<package>.Launcher`, rather than being told
 * the list. That is what keeps adding a theme to `LAUNCHER_ICONS` a one-line
 * change: the alias appears, the native side discovers it, and nothing in
 * Kotlin has to be edited to match. Renaming this constant means renaming it
 * there too, and means every home screen shortcut pointing at the old name
 * breaks.
 */
const ALIAS_PREFIX = 'Launcher';
const ICON_PREFIX = 'ic_launcher_';
const COLOR_PREFIX = 'launcher_';

/** `nord` reads as `Nord` in a component name, which is the Android convention. */
function aliasSuffix(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function backgroundColorName(theme: string): string {
  return `${COLOR_PREFIX}background_${theme}`;
}

function glyphColorName(theme: string): string {
  return `${COLOR_PREFIX}glyph_${theme}`;
}

/**
 * The adaptive icon, for API 26 and up.
 *
 * `monochrome` is the app's own and is not themed: on Android 13's themed icons
 * the system supplies both colours from the wallpaper, so a per-theme monochrome
 * layer would be eight identical silhouettes.
 */
function adaptiveIconXml(theme: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${backgroundColorName(theme)}"/>
    <foreground>
        <bitmap android:src="@mipmap/ic_launcher_foreground" android:tint="@color/${glyphColorName(theme)}"/>
    </foreground>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
}

/**
 * The same icon for API 24 and 25, which have no `adaptive-icon`.
 *
 * `-anydpi` beats every density folder at resource resolution and `-anydpi-v26`
 * beats this on the releases that can use it, so the two files never both apply.
 */
function legacyIconXml(theme: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/${backgroundColorName(theme)}"/>
    <item>
        <bitmap android:src="@mipmap/ic_launcher_foreground" android:tint="@color/${glyphColorName(theme)}"/>
    </item>
</layer-list>
`;
}

/** The two colours every icon is built from, in `values/colors.xml`. */
const withLauncherIconColors: ConfigPlugin = (config) =>
  withAndroidColors(config, (config) => {
    for (const [theme, icon] of Object.entries(LAUNCHER_ICONS)) {
      config.modResults = AndroidConfig.Colors.assignColorValue(config.modResults, {
        name: backgroundColorName(theme),
        value: icon.background,
      });
      config.modResults = AndroidConfig.Colors.assignColorValue(config.modResults, {
        name: glyphColorName(theme),
        value: icon.glyph,
      });
    }
    return config;
  });

/** The drawables themselves, written straight into the generated `res` folder. */
const withLauncherIconDrawables: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const res = await AndroidConfig.Paths.getResourceFolderAsync(config.modRequest.projectRoot);

      const adaptive = path.join(res, 'mipmap-anydpi-v26');
      const legacy = path.join(res, 'mipmap-anydpi');
      await fs.mkdir(adaptive, { recursive: true });
      await fs.mkdir(legacy, { recursive: true });

      for (const theme of Object.keys(LAUNCHER_ICONS)) {
        await fs.writeFile(path.join(adaptive, `${ICON_PREFIX}${theme}.xml`), adaptiveIconXml(theme));
        await fs.writeFile(path.join(legacy, `${ICON_PREFIX}${theme}.xml`), legacyIconXml(theme));
      }

      return config;
    },
  ]);

/**
 * One alias per theme, and no launcher filter on `MainActivity`.
 *
 * `android:enabled` here is only the state a *fresh install* starts in. Once the
 * app has called `setComponentEnabledSetting` the override is the package
 * manager's and survives updates, so this decides nothing after the first run.
 */
const withLauncherAliases: ConfigPlugin = (config) =>
  withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);

    const isLauncherFilter = (filter: AndroidConfig.Manifest.ManifestIntentFilter) =>
      Boolean(filter.action?.some((a) => a.$['android:name'] === 'android.intent.action.MAIN')) &&
      Boolean(
        filter.category?.some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER'),
      );

    mainActivity['intent-filter'] = (mainActivity['intent-filter'] ?? []).filter(
      (filter) => !isLauncherFilter(filter),
    );

    // Idempotent: a prebuild without --clean runs this over a manifest that may
    // already carry a previous pass's aliases, and a theme deleted since then
    // must not survive in it.
    const foreign = (application['activity-alias'] ?? []).filter(
      (alias) => !alias.$?.['android:name']?.startsWith(`.${ALIAS_PREFIX}`),
    );

    application['activity-alias'] = [
      ...foreign,
      ...Object.keys(LAUNCHER_ICONS).map((theme) => ({
        $: {
          'android:name': `.${ALIAS_PREFIX}${aliasSuffix(theme)}`,
          'android:targetActivity': '.MainActivity',
          'android:enabled': theme === DEFAULT_LAUNCHER_ICON ? 'true' : 'false',
          // Required of anything carrying an intent filter, and true because
          // the launcher is another app.
          'android:exported': 'true',
          'android:icon': `@mipmap/${ICON_PREFIX}${theme}`,
          // Only API 25 reads this, and it gets the square from `mipmap-anydpi`.
          // Left pointing at the theme's icon anyway: without it the alias
          // inherits the application's, which is the default theme's icon.
          'android:roundIcon': `@mipmap/${ICON_PREFIX}${theme}`,
          // No `android:label`. An alias without one shows the application
          // label, which is the app's name and is already right.
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          },
        ],
      })),
    ] as AndroidConfig.Manifest.ManifestActivityAlias[];

    return config;
  });

const withThemeLauncherIcons: ConfigPlugin = (config) =>
  withLauncherAliases(withLauncherIconDrawables(withLauncherIconColors(config)));

export default withThemeLauncherIcons;
