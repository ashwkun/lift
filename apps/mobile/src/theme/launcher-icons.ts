/**
 * The two colours each theme's launcher icon is drawn in.
 *
 * The icon on the home screen is a *build* artifact: Android picks it from
 * resources compiled into the APK, so there is one drawable per theme and the
 * app only ever chooses between them (see `theme/app-icon.ts` for how, and
 * `plugins/with-theme-launcher-icons.ts` for what it is choosing from). This
 * file is the input to that generator and the app's own record of what it
 * generated.
 *
 * Each entry is a theme's `surface` and its `accent`, which is what makes an
 * icon recognisably the theme's rather than merely tinted: `surface` is the
 * colour of every card in the app, and `accent` is the one loud thing on the
 * screen. The `dark` pair below is exactly the icon this app shipped before any
 * of this existed, because that icon was already drawn in those two colours.
 *
 * `background` is `surface` rather than `background` (the token) on purpose.
 * Three of the dark palettes have a true-black canvas, and a black icon under
 * the launcher's mask is a glyph floating on the wallpaper rather than an app
 * icon: `surface` is the same palette one step up, and is what the eye reads as
 * "the app's colour" anyway.
 *
 * ## Why the values are written out rather than read from the palettes
 *
 * Because the generator runs in Node, during `expo prebuild`, and `tokens.ts`
 * imports react-native. Nothing that reaches `darkPalette` from a config plugin
 * can avoid loading the whole module graph behind it, so the two colours the
 * icons need are copied here, where a plugin can read them.
 *
 * That copy can drift, and drift is silent: the icon keeps the old colour and
 * nothing in the app looks wrong. `useLauncherIcon` in `theme/app-icon.ts`
 * checks the pair for the theme in use against its live palette on every dev
 * launch and warns if either has moved. Change a palette's `surface` or
 * `accent` and change it here too.
 */

import type { ThemeName } from '@lift/shared';

export interface LauncherIcon {
  /** The adaptive icon's background layer. The theme's `surface`. */
  background: string;
  /** The mark drawn on top of it. The theme's `accent`. */
  glyph: string;
}

/**
 * Keyed by `ThemeName`, so a theme added to `THEME_PREFERENCES` without an icon
 * is a type error rather than a build that quietly ships eight icons for nine
 * themes.
 */
export const LAUNCHER_ICONS: Record<ThemeName, LauncherIcon> = {
  light: { background: '#FFFFFF', glyph: '#54700A' },
  // `background` corrected from `#0C0C0F`, which was a `surface` two retunes
  // old: `warnOnDrift` had been reporting the pair every dev launch. The glyph
  // is unchanged, and is the lime this app has always been.
  dark: { background: '#1A1A1A', glyph: '#D2F34B' },
  nord: { background: '#1D222C', glyph: '#B8DAE3' },
  gruvbox: { background: '#1D2021', glyph: '#D5D942' },
  catppuccin: { background: '#15151F', glyph: '#E0CAFA' },
  spotify: { background: '#1A1A1A', glyph: '#1ED760' },
  fitness: { background: '#141416', glyph: '#FF375F' },
  solarized: { background: '#FDF6E3', glyph: '#185783' },
};

/**
 * The icon the APK ships enabled, before the app has ever chosen one.
 *
 * `dark`, matching the palette `resolveTheme` falls back to and the icon this
 * app used when it had only one. A fresh install shows this until the first
 * render, which is also the first time the stored preference is known.
 */
export const DEFAULT_LAUNCHER_ICON: ThemeName = 'dark';
