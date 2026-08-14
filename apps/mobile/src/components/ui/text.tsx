import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { font, fontSize, useColors, type Palette } from '@/theme';

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

/**
 * Negative tracking on the large sizes is deliberate. Inter is drawn on a
 * generous default sidebearing that reads well at body size and looks loose
 * above ~20px; Apple applies the same optical correction to SF Pro's display
 * cuts. Small text gets no tracking, and `overline` gets positive tracking
 * because uppercase needs the room.
 */
const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontSize: fontSize.display, ...font('bold'), letterSpacing: -0.8 },
  title: { fontSize: fontSize.xxxl, ...font('bold'), letterSpacing: -0.6 },
  heading: { fontSize: fontSize.xxl, ...font('semibold'), letterSpacing: -0.4 },
  subheading: { fontSize: fontSize.xl, ...font('semibold'), letterSpacing: -0.2 },
  body: { fontSize: fontSize.md, ...font('regular') },
  bodyMedium: { fontSize: fontSize.md, ...font('medium') },
  label: { fontSize: fontSize.sm, ...font('medium') },
  caption: { fontSize: fontSize.xs, ...font('regular') },
  overline: {
    fontSize: fontSize.xs,
    ...font('semibold'),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  numeric: {
    fontSize: fontSize.md,
    ...font('semibold'),
    fontVariant: ['tabular-nums'],
  },
  numericLarge: {
    fontSize: fontSize.xxxl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
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
