import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import {
  controlHeight,
  font,
  fontSize,
  hoverFill,
  radius,
  scaleAlpha,
  spacing,
  stroke,
  useColors,
  type Palette,
} from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

export type ButtonVariant =
  /** The one action a screen most wants you to take. At most one per view. */
  | 'primary'
  /** Filled but neutral — the companion action next to a primary. */
  | 'secondary'
  /** Outlined and transparent, for actions on top of a card or image. */
  | 'outline'
  /** Text only. Lowest weight; use inside rows and headers. */
  | 'ghost'
  /** Destructive and irreversible: delete a workout, discard a session. */
  | 'danger'
  /** Confirms and completes: finish workout, save. */
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

interface SizeSpec {
  height: number;
  paddingHorizontal: number;
  fontSize: number;
  iconSize: number;
  radius: number;
}

const SIZES: Record<ButtonSize, SizeSpec> = {
  sm: {
    height: controlHeight.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    iconSize: 16,
    radius: radius.sm,
  },
  md: {
    height: controlHeight.md,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
    iconSize: 18,
    radius: radius.md,
  },
  lg: {
    height: controlHeight.lg,
    paddingHorizontal: spacing.xl,
    fontSize: fontSize.lg,
    iconSize: 20,
    radius: radius.md,
  },
};

interface VariantSpec {
  bg: string;
  bgHover: string;
  bgPressed: string;
  fg: string;
  border?: string;
  /**
   * Outline at full press. Only for a variant whose border carries the press —
   * currently just `danger`. Omitting it leaves the border static, drawn from
   * the stylesheet, and keeps the extra colour interpolation off every other
   * button in the app.
   */
  borderPressed?: string;
}

/**
 * Every variant names its own pressed colour rather than leaning on opacity.
 *
 * Dimming works on a filled button and does nothing legible on a transparent
 * one, which is how ghost and outline ended up feeling dead to the touch while
 * primary felt fine. A colour per state makes all six respond identically.
 *
 * `bgHover` is the desktop addition, and it is derived rather than chosen — see
 * `hoverFill` in the theme for the rule and why it stops halfway.
 *
 * The two transparent variants are the exception and take the pressed fill
 * outright. There is nothing to blend from: `transparent` is not a colour, and
 * blending from a guess at whatever is behind the button would be wrong on
 * exactly the surfaces these two are for. They still answer a click, through
 * the scale rather than the fill.
 */
function variantSpecs(c: Palette): Record<ButtonVariant, VariantSpec> {
  return {
    primary: {
      bg: c.accent,
      bgHover: hoverFill(c.accent, c.accentPressed),
      bgPressed: c.accentPressed,
      fg: c.textOnAccent,
    },
    secondary: {
      bg: c.surfaceMuted,
      bgHover: hoverFill(c.surfaceMuted, c.surfacePressed),
      bgPressed: c.surfacePressed,
      fg: c.text,
      border: c.border,
    },
    outline: {
      bg: 'transparent',
      bgHover: c.surfaceMuted,
      bgPressed: c.surfaceMuted,
      fg: c.text,
      border: c.borderStrong,
    },
    ghost: {
      bg: 'transparent',
      bgHover: c.surfaceMuted,
      bgPressed: c.surfaceMuted,
      fg: c.accent,
    },
    /*
     * Tinted and outlined, not filled — the one variant that does not fill.
     *
     * Two reasons, and the first is that the filled version was unreadable. Its
     * label was `textOnDanger`, which on the old red measured 3.06 against a
     * 4.5 requirement, and no red bright enough for an AMOLED palette can carry
     * white text (see `danger` in the tokens). Printing the role colour on a
     * tint of itself reads 5.38 on the canvas and 4.87 on a card instead.
     *
     * The second is that a solid red slab was the loudest object on the screen,
     * reserved for the action the user least wants to take. `Discard workout`
     * sits at the bottom of a live session below a rule and a wide gap — it is
     * already hard to hit by accident, and it does not also need to shout. This
     * still reads unmistakably as destructive: it is the only red control in the
     * app, and the only one that is outlined in its own role colour.
     *
     * The press is carried by the outline rather than the fill, which is not a
     * stylistic choice. Deepening a tint that its own label is printed on closes
     * the gap between them — at 1.5× the label goes under AA on a card — so the
     * fill moves only 1.25× and the border, which is not text and has no ratio
     * to meet, travels the whole way to solid.
     */
    danger: {
      bg: c.dangerSurface,
      bgHover: scaleAlpha(c.dangerSurface, 1.125),
      bgPressed: scaleAlpha(c.dangerSurface, 1.25),
      fg: c.danger,
      border: scaleAlpha(c.dangerSurface, 2.5),
      borderPressed: c.danger,
    },
    success: {
      bg: c.success,
      bgHover: hoverFill(c.success, c.successPressed),
      bgPressed: c.successPressed,
      fg: c.textOnSuccess,
    },
  };
}

/**
 * Built once per palette, of which there are two.
 *
 * `variantSpecs` used to run on every render of every button, which was six
 * object literals and no arithmetic. It now also runs four sRGB blends, and a
 * button is a common enough leaf that recomputing a constant on every render of
 * it is not worth the simplicity. Same shape as `makeStyles` in the theme.
 */
const specCache = new Map<Palette, Record<ButtonVariant, VariantSpec>>();

function useVariantSpecs(colors: Palette): Record<ButtonVariant, VariantSpec> {
  let specs = specCache.get(colors);
  if (!specs) {
    specs = variantSpecs(colors);
    specCache.set(colors, specs);
  }
  return specs;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const colors = useColors();
  const dimensions = SIZES[size];
  const { bg, bgHover, bgPressed, fg, border, borderPressed } = useVariantSpecs(colors)[variant];

  const isDisabled = disabled || loading;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      // The fill crossfade and the scale are one gesture read two ways: colour
      // says the control acknowledged the touch, size says it moved under it.
      // Neither can fire while disabled — the press handlers are not wired at
      // all then — so the 40% in `styles.disabled` is the whole story there.
      fill={bg}
      fillPressed={bgPressed}
      hoverFill={bgHover}
      // Both or neither: `PressableScale` only drives the outline when it has
      // two ends to travel between, so the variants that name a static border
      // keep it from the stylesheet below.
      border={border}
      borderPressed={borderPressed}
      style={[
        styles.base,
        {
          height: dimensions.height,
          paddingHorizontal: dimensions.paddingHorizontal,
          borderRadius: dimensions.radius,
          backgroundColor: bg,
          borderColor: border ?? 'transparent',
          borderWidth: border ? stroke.outline : 0,
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {/*
        The label stays mounted while loading and is hidden with opacity, so the
        button keeps its width instead of collapsing to spinner-size and shoving
        whatever sits beside it sideways for the length of the request.
      */}
      <View style={[styles.content, loading && styles.hidden]}>
        {icon && iconPosition === 'left' && (
          <Ionicons name={icon} size={dimensions.iconSize} color={fg} />
        )}
        <Text
          numberOfLines={1}
          style={{ color: fg, fontSize: dimensions.fontSize, ...font('semibold') }}
        >
          {title}
        </Text>
        {icon && iconPosition === 'right' && (
          <Ionicons name={icon} size={dimensions.iconSize} color={fg} />
        )}
      </View>

      {loading && (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={fg} size="small" />
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hidden: { opacity: 0 },
  spinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
});
