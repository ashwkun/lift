/**
 * `app-icon`: which of the app's launcher icons is showing.
 *
 * A local Expo module for the reason `workout-live/index.ts` gives at length:
 * `android/` is generated and gitignored, and everything here survives
 * `expo prebuild --clean`.
 *
 * The icons themselves are not here. Android picks an app icon from compiled
 * resources, so one per theme is built into the APK by
 * `plugins/with-theme-launcher-icons.ts` and this module only chooses between
 * them. `AppIconModule.kt` is the other half.
 *
 * Android only. On iOS and in Expo Go `requireOptionalNativeModule` returns null
 * and both exports below no-op, the same shape every other native module in this
 * app uses. iOS can do this too, through `setAlternateIconName`, but it needs a
 * separate icon set in the bundle and this app has no iOS build.
 */

import { requireOptionalNativeModule } from 'expo';

interface AppIconNativeModule {
  getIcon(): string | null;
  setIcon(theme: string): Promise<boolean>;
}

const native = requireOptionalNativeModule<AppIconNativeModule>('AppIcon');

/** False on iOS, on the web, and in Expo Go, where the native half is not in the binary. */
export const appIconAvailable = native !== null;

/**
 * The theme whose icon is showing, lowercased, or null where there is no
 * launcher to ask.
 */
export function getAppIcon(): string | null {
  return native?.getIcon() ?? null;
}

/**
 * Shows the named theme's icon.
 *
 * Resolves false when the running binary has no icon for that theme, which is a
 * real state rather than a failure: an over-the-air update can add a theme to
 * the JavaScript before a native build ships the icon that goes with it. The
 * icon stays where it was.
 *
 * Takes a plain string rather than `ThemeName`. Nothing native knows what a
 * theme is, and this module is a switch that would work just as well for icons
 * chosen some other way. `theme/app-icon.ts` is where the app's own names meet
 * it.
 */
export async function setAppIcon(theme: string): Promise<boolean> {
  return (await native?.setIcon(theme)) ?? false;
}
