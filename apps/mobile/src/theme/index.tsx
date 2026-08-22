/**
 * Theme context and the `makeStyles` helper used across the app.
 */

import type { ThemeName, ThemePreference } from '@lift/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ColorSchemeName,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useSettings } from '@/store/settings';

import {
  catppuccinPalette,
  fitnessPalette,
  gruvboxPalette,
  nordPalette,
  solarizedPalette,
  spotifyPalette,
} from './palettes';
import { darkPalette, lightPalette, type ColorScheme, type Palette } from './tokens';
import { useWebChrome } from './web-chrome';

export * from './color';
export * from './layout';
export * from './motion';
export * from './palettes';
export * from './tokens';

export interface ThemeValue {
  colors: Palette;
  /**
   * The light/dark side this theme sits on, not which theme it is.
   *
   * Nothing should branch on the theme's *name*. That is what the palette is
   * for, and a component that special-cases one theme will be wrong for the
   * next one added. This exists only for the three decisions a palette cannot
   * express; see `ColorScheme` in the tokens.
   */
  scheme: ColorScheme;
  isDark: boolean;
}

/**
 * Every theme that names a palette, and which side of the light/dark line it
 * falls on.
 *
 * Keyed by `ThemeName`, so adding a value to `THEME_PREFERENCES` in
 * `@lift/shared` without adding it here is a type error rather than a theme
 * that silently renders as dark.
 */
export const THEMES: Record<ThemeName, { colors: Palette; scheme: ColorScheme }> = {
  light: { colors: lightPalette, scheme: 'light' },
  dark: { colors: darkPalette, scheme: 'dark' },
  nord: { colors: nordPalette, scheme: 'dark' },
  gruvbox: { colors: gruvboxPalette, scheme: 'dark' },
  catppuccin: { colors: catppuccinPalette, scheme: 'dark' },
  spotify: { colors: spotifyPalette, scheme: 'dark' },
  fitness: { colors: fitnessPalette, scheme: 'dark' },
  solarized: { colors: solarizedPalette, scheme: 'light' },
};

const ThemeContext = createContext<ThemeValue>({
  colors: darkPalette,
  scheme: 'dark',
  isDark: true,
});

/**
 * Resolves a stored preference to a theme.
 *
 * `system` is the only value that consults the OS; every other preference is a
 * palette the user picked outright and applies whatever the phone is doing,
 * which is the whole point of picking one.
 *
 * The fallback is not dead code. `themePreference` is read back from a JSON
 * blob in SQLite, so a build that removes a theme will find installs still
 * holding its name, and an unknown key must not leave the app with an
 * undefined palette.
 */
export function resolveTheme(
  preference: ThemePreference,
  // `ColorSchemeName`, widened: React Native also reports 'unspecified', which
  // falls through to the same dark default as null.
  systemScheme: ColorSchemeName,
): ThemeValue {
  // Default to dark when the system scheme is unknown. A gym app is used in
  // dim rooms far more often than bright ones, and a white flash at 6am is
  // genuinely unpleasant.
  const name: ThemeName = preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;
  const theme = THEMES[name] ?? THEMES.dark;

  return { colors: theme.colors, scheme: theme.scheme, isDark: theme.scheme === 'dark' };
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const preference = useSettings((state) => state.themePreference);

  const value = useMemo<ThemeValue>(
    () => resolveTheme(preference, systemScheme),
    [preference, systemScheme],
  );

  // Paints the parts of a browser window that sit outside this tree: the
  // document background, the scrollbars, the focus ring. No-op off the web.
  useWebChrome(value.colors, value.scheme);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Builds a theme-aware stylesheet.
 *
 * The factory runs at most once per palette and the result is cached, so this
 * costs nothing per render while still letting styles read theme colors. The
 * cache is keyed on the palette object itself, so it holds one entry per theme
 * the user has actually visited this session rather than one per theme that
 * exists:
 *
 * ```ts
 * const useStyles = makeStyles((c) => ({ card: { backgroundColor: c.surface } }));
 * // inside a component:
 * const styles = useStyles();
 * ```
 */
export function makeStyles<T extends NamedStyles>(factory: (colors: Palette) => T) {
  const cache = new Map<Palette, T>();

  return function useThemedStyles(): T {
    const colors = useColors();

    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors)) as T;
      cache.set(colors, styles);
    }
    return styles;
  };
}
