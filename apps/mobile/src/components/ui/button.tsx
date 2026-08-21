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
    danger: {
      bg: c.danger,
      bgHover: hoverFill(c.danger, c.dangerPressed),
      bgPressed: c.dangerPressed,
      fg: c.textOnDanger,
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
  const { bg, bgHover, bgPressed, fg, border } = useVariantSpecs(colors)[variant];

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
