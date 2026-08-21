/**
 * Theme context and the `makeStyles` helper used across the app.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useSettings } from '@/store/settings';

import { darkPalette, lightPalette, type Palette } from './tokens';
import { useWebChrome } from './web-chrome';

export * from './color';
export * from './layout';
export * from './motion';
export * from './tokens';

export type ColorScheme = 'light' | 'dark';

export interface ThemeValue {
  colors: Palette;
  scheme: ColorScheme;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue>({
  colors: darkPalette,
  scheme: 'dark',
  isDark: true,
});

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const preference = useSettings((state) => state.themePreference);

  // Default to dark when the system scheme is unknown — a gym app is used in
  // dim rooms far more often than bright ones, and a white flash at 6am is
  // genuinely unpleasant.
  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const value = useMemo<ThemeValue>(
    () => ({
      colors: scheme === 'dark' ? darkPalette : lightPalette,
      scheme,
      isDark: scheme === 'dark',
    }),
    [scheme],
  );

  // Paints the parts of a browser window that sit outside this tree — the
  // document background, the scrollbars, the focus ring. No-op off the web.
  useWebChrome(value.colors, scheme);

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
 * The factory runs at most once per palette (there are only two) and the result
 * is cached, so this costs nothing per render while still letting styles read
 * theme colors:
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
