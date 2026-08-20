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
  /**
   * Weights, reps and timers — the figures that sit in a column or tick in
   * place. Declares `tabular-nums`, so digits keep one width and nothing
   * reflows as a value changes. Whether the loaded family can honour that is a
   * property of the font, recorded once in `fontFamily` in the tokens.
   */
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
 * Four weights across eleven roles, and the whole hierarchy is here: size, and
 * which cut. 400 for reading, 500 for a row that names something, 700 for
 * anything to be scanned rather than read, 800 for the three headline sizes.
 *
 * Nothing is set below 400 — see `fontFamily` in the tokens for why that floor
 * exists and what to reach for instead when something needs to recede.
 *
 * Negative tracking on the large sizes is deliberate: type spaced for running
 * text looks loose above ~20px, and Apple applies the same optical correction
 * to SF Pro's display cuts. These values are back near full strength — the
 * previous family was a display optical size that arrived with the correction
 * already drawn in, and this one does not.
 *
 * Small text gets no tracking. This family is wide and its x-height is low, so
 * at 11px and 13px the space goes to fitting words into fixed columns rather
 * than to letterspacing. `overline` is the exception and keeps its positive
 * tracking, because uppercase needs the room — it is the app's label voice.
 */
const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontSize: fontSize.display, ...font('display'), letterSpacing: -0.6 },
  title: { fontSize: fontSize.xxxl, ...font('display'), letterSpacing: -0.5 },
  heading: { fontSize: fontSize.xxl, ...font('display'), letterSpacing: -0.3 },
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
    letterSpacing: -0.6,
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
