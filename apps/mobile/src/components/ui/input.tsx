import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { controlHeight, font, fontSize, HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { Text } from './text';

// Derived from the prop rather than imported by name: React Native has renamed
// these payload types across versions, and deriving keeps this compiling
// through the next rename.
type FocusHandler = NonNullable<TextInputProps['onFocus']>;
type BlurHandler = NonNullable<TextInputProps['onBlur']>;

/**
 * Tracks focus while still forwarding whatever `onFocus`/`onBlur` the caller
 * passed, so a focus ring never costs a component its own handlers.
 */
function useFocusRing(props: Pick<TextInputProps, 'onFocus' | 'onBlur'>) {
  const [focused, setFocused] = useState(false);

  const onFocus: FocusHandler = (event) => {
    setFocused(true);
    props.onFocus?.(event);
  };

  const onBlur: BlurHandler = (event) => {
    setFocused(false);
    props.onBlur?.(event);
  };

  return { focused, onFocus, onBlur };
}

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

export interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  onClear?: () => void;
  style?: ViewStyle;
}

export function SearchBar({ value, onClear, style, onFocus, onBlur, ...rest }: SearchBarProps) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  return (
    <View
      style={[
        styles.searchContainer,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: ring.focused ? colors.accent : 'transparent',
        },
        style,
      ]}
    >
      <Ionicons
        name="search"
        size={17}
        color={ring.focused ? colors.accent : colors.textTertiary}
      />
      <TextInput
        value={value}
        placeholderTextColor={colors.textTertiary}
        style={[styles.searchInput, { color: colors.text }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
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
  /** Styles the input itself — a `TextInput` takes text styles, not view styles. */
  style?: StyleProp<TextStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  // Error outranks focus: a field you are typing into is still the field that
  // is wrong, and swapping red for blue on focus hides that until you leave.
  const borderColor = error ? colors.danger : ring.focused ? colors.accent : colors.border;

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
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={[
          styles.field,
          { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor },
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
  style?: StyleProp<TextStyle>;
}

export const NumericField = forwardRef<TextInput, NumericFieldProps>(function NumericField(
  { value, ghost = false, align = 'center', style, onFocus, onBlur, ...rest },
  ref,
) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  return (
    <TextInput
      ref={ref}
      value={value}
      // `decimal-pad` rather than `numeric`: it omits the sign and exponent keys
      // that make no sense for a weight, and keeps a decimal point for plates.
      keyboardType="decimal-pad"
      selectTextOnFocus
      placeholderTextColor={colors.textTertiary}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={[
        styles.numericField,
        {
          backgroundColor: ghost ? 'transparent' : colors.surfaceMuted,
          color: ghost ? colors.textTertiary : colors.text,
          // The ring matters more here than anywhere else: set rows put several
          // of these side by side, and mid-set you need to know at a glance
          // which box the keyboard is pointed at.
          borderColor: ring.focused ? colors.accent : 'transparent',
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
    height: controlHeight.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    padding: 0,
  },
  fieldContainer: { gap: spacing.xs },
  field: {
    height: controlHeight.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    borderWidth: 1,
  },
  numericField: {
    minWidth: 62,
    height: 34,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.md,
    ...font('semibold'),
    fontVariant: ['tabular-nums'],
    borderWidth: 1,
  },
});
