import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing, useColors } from '@/theme';

import { Text } from './text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `sm` is for a control nested inside a card, next to a heading. */
  size?: 'sm' | 'md';
  /** Announced before the selected segment, e.g. "Time range". */
  label?: string;
  style?: ViewStyle;
}

/**
 * A row of mutually exclusive options in a single track.
 *
 * Used where the choice reshapes the view rather than filtering it — the chart's
 * metric and time range. `FilterSelect` is the counterpart for dimensions with
 * many values: this one shows every option at once, so it stops being usable
 * past four or five.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  style,
}: SegmentedControlProps<T>) {
  const colors = useColors();
  const height = size === 'sm' ? 30 : 36;

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.surfaceMuted, padding: 3 }, style]}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label ? `${label}: ${option.label}` : option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              { height },
              // The selected segment is the only one that gets a surface. An
              // unselected press tints instead, so the two states never read as
              // the same thing mid-tap.
              selected
                ? { backgroundColor: colors.surface, borderColor: colors.border }
                : pressed
                  ? { backgroundColor: colors.surfacePressed, borderColor: 'transparent' }
                  : { borderColor: 'transparent' },
            ]}
          >
            <Text
              variant="label"
              numberOfLines={1}
              style={{ color: selected ? colors.text : colors.textSecondary }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm + 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
