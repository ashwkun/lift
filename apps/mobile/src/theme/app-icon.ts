/**
 * The one piece of this app's colour that lives outside the app: its icon on
 * the home screen.
 *
 * Same shape as `web-chrome.ts`, and for the same reason. Something the palette
 * has to dress that no style prop in this tree can reach, so it is driven from
 * the theme provider by an effect and is a no-op wherever the surface does not
 * exist.
 *
 * What it cannot do is paint. Android picks an app icon from resources compiled
 * into the APK, so the palette cannot be handed to it at runtime: every theme's
 * icon is built into the binary ahead of time and this chooses between them. See
 * `plugins/with-theme-launcher-icons.ts` for how they get there and what the
 * choosing costs.
 */

import type { ThemeName } from '@lift/shared';
import { appIconAvailable, setAppIcon } from '@modules/app-icon';
import { useEffect } from 'react';

import { useSettings } from '@/store/settings';

import { LAUNCHER_ICONS } from './launcher-icons';
import type { Palette } from './tokens';

/**
 * Points the launcher at the current theme's icon.
 *
 * Keyed on the resolved theme rather than the stored preference, so 'system'
 * moves the icon when the OS flips between light and dark, exactly as it moves
 * the palette.
 *
 * No cleanup and nothing to undo: the choice is persisted by the package
 * manager, survives the process, and is meant to. Unmounting this app should
 * not put its old icon back.
 *
 * ## Why it waits for hydration
 *
 * Because the theme before settings arrive is not the user's. `themePreference`
 * starts at its default and the stored one lands a moment later, so a provider
 * that applied every value it saw would set the icon to the default on every
 * cold start and then correct it. On screen that is nothing: two renders. On the
 * home screen it is the launcher redrawing the app's icon twice per launch,
 * ending on the right one. Nothing is lost by waiting: the icon is already
 * whatever the last run left it as, which is the answer this is about to
 * recompute.
 */
export function useLauncherIcon(name: ThemeName, colors: Palette): void {
  const hydrated = useSettings((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    if (__DEV__) warnOnDrift(name, colors);
    if (!appIconAvailable) return;

    // Fire and forget. A launcher icon is not worth a retry, a state flag or a
    // frame of anyone's attention: the native side is idempotent, and the next
    // theme change or app launch runs this again anyway.
    void setAppIcon(name);
  }, [hydrated, name, colors]);
}

/**
 * Warns when the icon's colours no longer match the palette they were copied
 * from.
 *
 * `launcher-icons.ts` explains why they are a copy: the generator runs in Node
 * during prebuild and cannot load a module that imports react-native. The copy
 * can therefore drift, and drift is invisible. The app looks right and the icon
 * is a colour the app no longer uses.
 *
 * Only the theme currently in use is checked, because that is the only palette
 * this hook is handed. In practice that is the theme whose colours were just
 * changed: nobody edits `nordPalette` without looking at Nord.
 */
function warnOnDrift(name: ThemeName, colors: Palette): void {
  const icon = LAUNCHER_ICONS[name];
  if (!icon) return;

  const stale =
    icon.background.toUpperCase() !== colors.surface.toUpperCase() ||
    icon.glyph.toUpperCase() !== colors.accent.toUpperCase();

  if (stale) {
    console.warn(
      `[app-icon] The ${name} launcher icon is drawn in ${icon.background}/${icon.glyph}, but that palette is now ${colors.surface}/${colors.accent}. Update LAUNCHER_ICONS in theme/launcher-icons.ts and re-run prebuild.`,
    );
  }
}
