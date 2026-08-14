import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { fontSize, fontWeight, HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { Text } from './text';

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

export interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  onClear?: () => void;
  style?: ViewStyle;
}

export function SearchBar({ value, onClear, style, ...rest }: SearchBarProps) {
  const colors = useColors();

  return (
    <View
      style={[styles.searchContainer, { backgroundColor: colors.surfaceMuted }, style]}
    >
      <Ionicons name="search" size={17} color={colors.textTertiary} />
      <TextInput
        value={value}
        placeholderTextColor={colors.textTertiary}
        style={[styles.searchInput, { color: colors.text }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        {...rest}
      />
      {value ? (
        <Pressable onPress={onClear} hitSlop={HIT_SLOP} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
  style?: ViewStyle;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, containerStyle, style, ...rest },
  ref,
) {
  const colors = useColors();

  return (
    <View style={[styles.fieldContainer, containerStyle]}>
      {label && (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.field,
          {
            backgroundColor: colors.surfaceMuted,
            color: colors.text,
            borderColor: error ? colors.danger : colors.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// NumericField — used by set rows
// ---------------------------------------------------------------------------

export interface NumericFieldProps extends Omit<TextInputProps, 'style' | 'value'> {
  value: string;
  /** Dims the field and shows the previous session's value as a placeholder. */
  ghost?: boolean;
  align?: 'left' | 'center' | 'right';
  style?: ViewStyle;
}

export const NumericField = forwardRef<TextInput, NumericFieldProps>(function NumericField(
  { value, ghost = false, align = 'center', style, ...rest },
  ref,
) {
  const colors = useColors();

  return (
    <TextInput
      ref={ref}
      value={value}
      // `decimal-pad` rather than `numeric`: it omits the sign and exponent keys
      // that make no sense for a weight, and keeps a decimal point for plates.
      keyboardType="decimal-pad"
      selectTextOnFocus
      placeholderTextColor={colors.textTertiary}
      style={[
        styles.numericField,
        {
          backgroundColor: ghost ? 'transparent' : colors.surfaceMuted,
          color: ghost ? colors.textTertiary : colors.text,
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.md,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    padding: 0,
  },
  fieldContainer: { gap: spacing.xs },
  field: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  numericField: {
    minWidth: 62,
    height: 34,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
