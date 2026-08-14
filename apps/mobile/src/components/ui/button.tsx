import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { fontSize, fontWeight, radius, spacing, useColors, MIN_TOUCH_SIZE } from '@/theme';

import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
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

const SIZES: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { height: 34, paddingHorizontal: spacing.md, fontSize: fontSize.sm },
  md: { height: MIN_TOUCH_SIZE, paddingHorizontal: spacing.lg, fontSize: fontSize.md },
  lg: { height: 52, paddingHorizontal: spacing.xl, fontSize: fontSize.lg },
};

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
  const isDisabled = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.accent, fg: colors.textOnAccent },
    secondary: { bg: colors.surfaceMuted, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.accent },
    danger: { bg: colors.danger, fg: '#FFFFFF' },
    success: { bg: colors.success, fg: '#FFFFFF' },
  };

  const { bg, fg, border } = palette[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: dimensions.height,
          paddingHorizontal: dimensions.paddingHorizontal,
          backgroundColor: bg,
          borderColor: border ?? 'transparent',
          borderWidth: border ? StyleSheet.hairlineWidth : 0,
        },
        fullWidth && styles.fullWidth,
        // Opacity rather than a separate pressed colour keeps every variant
        // (including transparent ghosts) reacting consistently.
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' && (
            <Ionicons name={icon} size={dimensions.fontSize + 3} color={fg} />
          )}
          <Text style={{ color: fg, fontSize: dimensions.fontSize, fontWeight: fontWeight.semibold }}>
            {title}
          </Text>
          {icon && iconPosition === 'right' && (
            <Ionicons name={icon} size={dimensions.fontSize + 3} color={fg} />
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
