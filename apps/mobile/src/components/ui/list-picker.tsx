import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { controlHeight, radius, spacing, stroke, useColors } from '@/theme';

import { FilterSheet } from './filter-select';
import { Divider } from './surfaces';
import { Text } from './text';

export interface ListPickerOption<T extends string> {
  value: T;
  label: string;
}

export interface ListPickerProps<T extends string> {
  /** Names the dimension. Heads the sheet and prefixes the accessibility label. */
  label: string;
  options: readonly ListPickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A full-width trigger that opens a list of choices in a sheet.
 *
 * A trigger rather than a `SegmentedControl`: five options at "Last 3 months"
 * length do not fit across a phone, and abbreviating them to "3M" trades the
 * one thing the control has to say for the space it saves. It also stays one
 * line however many options are offered, which a segmented track does not.
 *
 * Deliberately *not* built on `FilterTrigger`. That control paints itself in
 * the accent whenever it holds a value, which is right for a filter — an active
 * filter is hiding rows — and wrong here: one of these options is always
 * selected, so an accented pill would be permanently lit and would spend the
 * screen's one loud colour on a control rather than on the data.
 */
export function ListPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: ListPickerProps<T>) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityHint={`Opens the ${label.toLowerCase()} picker`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => {
          const fill = pressed ? colors.surfacePressed : colors.surfaceMuted;
          // The outline is the fill rather than transparent: the border is drawn
          // in every state so the pill holds one width, and a see-through stroke
          // around a radius seams on Android. See `stroke` in the tokens.
          return [styles.trigger, { backgroundColor: fill, borderColor: fill }];
        }}
      >
        <Text variant="bodyMedium" numberOfLines={1}>
          {current?.label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      </Pressable>

      <FilterSheet visible={open} label={label} onClose={() => setOpen(false)}>
        <View style={styles.options}>
          {options.map((option, index) => (
            <View key={option.value}>
              {index > 0 && <Divider />}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: option.value === value }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <Text
                  variant="body"
                  style={[styles.optionLabel, option.value === value && { color: colors.accent }]}
                >
                  {option.label}
                </Text>
                {option.value === value && (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                )}
              </Pressable>
            </View>
          ))}
        </View>
      </FilterSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: controlHeight.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  options: { paddingBottom: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: controlHeight.md + 4,
  },
  optionLabel: { flex: 1 },
});
