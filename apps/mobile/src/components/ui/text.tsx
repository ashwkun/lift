import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { fontSize, fontWeight, useColors, type Palette } from '@/theme';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyMedium'
  | 'label'
  | 'caption'
  | 'overline'
  /** Weights, reps and timers — tabular so digits don't shift while editing. */
  | 'numeric'
  | 'numericLarge';

type TextColor = Extract<
  keyof Palette,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'textOnAccent'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'record'
>;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: TextStyle['textAlign'];
}

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontSize: fontSize.display, fontWeight: fontWeight.bold, letterSpacing: -0.5 },
  title: { fontSize: fontSize.xxxl, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  heading: { fontSize: fontSize.xxl, fontWeight: fontWeight.semibold, letterSpacing: -0.3 },
  subheading: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
  body: { fontSize: fontSize.md, fontWeight: fontWeight.regular },
  bodyMedium: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  caption: { fontSize: fontSize.xs, fontWeight: fontWeight.regular },
  overline: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  numeric: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  numericLarge: {
    fontSize: fontSize.xxxl,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
};

export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  const colors = useColors();

  return (
    <RNText
      style={[VARIANTS[variant], { color: colors[color] }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
