import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { font, fontSize, letterSpacing, lineHeight, useColors, type Palette } from '@/theme';

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
   * Weights, reps and timers. The figures that sit in a column or tick in
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
 * Three cuts across eleven roles, and the whole hierarchy is here: size, line
 * height, and which face. Ported from Nuvio's `NuvioTypography`, which spends
 * its weight the same way: Regular for reading, SemiBold for anything that
 * names or labels something, Bold for the headline sizes and nowhere else.
 *
 * **The headline roles are Bold, not Extrabold.** That is the one deliberate
 * step down from what this file had, and it is Nuvio's own choice — it sets
 * `displayLarge` in Bold and everything under it in SemiBold. The family has no
 * 800 to fall back on either way; see `fontFamily` in the tokens.
 *
 * The middle of the ladder went the other way. `bodyMedium` and `label` asked
 * for a 500 the family does not have, and they now name SemiBold rather than
 * collapse into `body` and `caption`. Same note in the tokens has the reasoning.
 *
 * Nothing is set below 400: see `fontFamily` in the tokens for why that floor
 * exists and what to reach for instead when something needs to recede.
 *
 * Every role now carries an explicit `lineHeight`, which none of them did
 * before. Multi-line text was on whichever default the platform picked, and the
 * two platforms do not pick the same one.
 *
 * Tracking is Nuvio's, which is a blunter rule than the four graded steps this
 * file used: the optical correction that keeps large type from looking loose
 * arrives at `display` and `title` only, and harder than before. `heading` and
 * `subheading` now get none. `overline` keeps its positive tracking, because
 * uppercase needs the room. It is the app's label voice.
 */
const VARIANTS: Record<TextVariant, TextStyle> = {
  display: {
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    ...font('display'),
    letterSpacing: letterSpacing.pageDisplay,
  },
  title: {
    fontSize: fontSize.xxxl,
    lineHeight: lineHeight.xxxl,
    ...font('display'),
    letterSpacing: letterSpacing.headline,
  },
  heading: { fontSize: fontSize.xxl, lineHeight: lineHeight.xxl, ...font('display') },
  subheading: { fontSize: fontSize.xl, lineHeight: lineHeight.xl, ...font('semibold') },
  body: { fontSize: fontSize.md, lineHeight: lineHeight.md, ...font('regular') },
  bodyMedium: { fontSize: fontSize.md, lineHeight: lineHeight.md, ...font('medium') },
  label: { fontSize: fontSize.sm, lineHeight: lineHeight.sm, ...font('medium') },
  caption: { fontSize: fontSize.xs, lineHeight: lineHeight.xs, ...font('regular') },
  overline: {
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    ...font('semibold'),
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
  },
  numeric: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    ...font('semibold'),
    fontVariant: ['tabular-nums'],
  },
  /**
   * A figure that is being read rather than announced: one step above body and
   * the same size as `subheading`, which the new ladder puts at 18px.
   *
   * It was 32px, and every stat surface in the app inherited that: the history
   * tiles, the workout summary, the monthly report, the muscle-set breakdown.
   * Four numbers at 32 on one screen is not a hierarchy, it is four things all
   * shouting, and it made a volume total look like the point of the app when
   * the point is the training underneath it. Nothing here needs to be legible
   * across a room; what needs that asks for a size explicitly, and there are
   * exactly two: the rest timer and the plate calculator.
   *
   * Its tracking is now zero rather than -0.2, which is the same rule the
   * headline variants above follow: the correction for type spaced for running
   * text is Nuvio's two-step one, and at this size it is spent.
   */
  numericLarge: {
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
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
