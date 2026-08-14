/**
 * Design tokens.
 *
 * Both palettes define the *same* key set so components can read
 * `colors.surface` without ever branching on scheme. Semantic names
 * (`surface`, `textSecondary`) rather than literal ones (`gray800`) because the
 * light palette inverts lightness — a name like `gray800` would be a lie in one
 * of the two themes.
 */

import { Platform } from 'react-native';

export interface Palette {
  /** App canvas, behind everything. */
  background: string;
  /** Cards, list rows, sheets. */
  surface: string;
  /** Raised surfaces: modals, menus, pressed states. */
  surfaceElevated: string;
  /** Subtle fills — input backgrounds, chips, table stripes. */
  surfaceMuted: string;
  /** Hairline dividers. */
  border: string;
  /** Visible outlines: focused inputs, selected chips. */
  borderStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Text sitting on an accent-filled surface. */
  textOnAccent: string;

  accent: string;
  accentPressed: string;
  /** Tinted background for accent chips and selected rows. */
  accentSurface: string;

  success: string;
  warning: string;
  danger: string;
  dangerSurface: string;
  /** Personal-record gold. */
  record: string;
  recordSurface: string;

  /** Scrim behind modals. */
  overlay: string;
  /** Skeleton/shimmer base. */
  skeleton: string;
}

export const darkPalette: Palette = {
  background: '#0E0E10',
  surface: '#1A1A1D',
  surfaceElevated: '#242429',
  surfaceMuted: '#2A2A30',
  border: '#2A2A2F',
  borderStrong: '#3C3C44',

  text: '#FFFFFF',
  textSecondary: '#9B9BA4',
  textTertiary: '#6A6A73',
  textOnAccent: '#FFFFFF',

  accent: '#3B82F6',
  accentPressed: '#2563EB',
  accentSurface: 'rgba(59, 130, 246, 0.16)',

  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerSurface: 'rgba(239, 68, 68, 0.15)',
  record: '#FBBF24',
  recordSurface: 'rgba(251, 191, 36, 0.16)',

  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#242429',
};

export const lightPalette: Palette = {
  background: '#F4F4F6',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EFEFF2',
  border: '#E2E2E8',
  borderStrong: '#C9C9D2',

  text: '#111114',
  textSecondary: '#6B6B75',
  textTertiary: '#95959F',
  textOnAccent: '#FFFFFF',

  accent: '#2563EB',
  accentPressed: '#1D4ED8',
  accentSurface: 'rgba(37, 99, 235, 0.12)',

  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  dangerSurface: 'rgba(220, 38, 38, 0.10)',
  record: '#D97706',
  recordSurface: 'rgba(217, 119, 6, 0.14)',

  overlay: 'rgba(0, 0, 0, 0.4)',
  skeleton: '#E7E7EC',
};

/** 4-point spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  display: 40,
} as const;

/**
 * Numeric values (weights, reps, volume) use tabular figures where available so
 * digits don't jitter as a set is edited or a timer counts down.
 */
export const fontFamily = Platform.select({
  ios: { regular: 'System', mono: 'ui-monospace' },
  android: { regular: 'sans-serif', mono: 'monospace' },
  default: { regular: 'System', mono: 'monospace' },
});

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/** Elevation presets. iOS uses shadows, Android uses elevation. */
export function elevation(level: 0 | 1 | 2 | 3) {
  if (level === 0) return {};

  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.08 * level,
      shadowRadius: 4 * level,
      shadowOffset: { width: 0, height: level },
    },
    android: { elevation: level * 2 },
    default: {},
  });
}

/** Minimum touch target. Set rows are dense, so this is enforced deliberately. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH_SIZE = 44;
