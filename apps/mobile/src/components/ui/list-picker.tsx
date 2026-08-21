import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { controlHeight, radius, spacing, stroke, useColors } from '@/theme';

import { FilterSheet } from './filter-select';
import { Divider } from './surfaces';
import { Text } from './text';

export interface ListPickerOption<T extends string> {
  value: T;
  label: string;
  /**
   * A quieter second line under the label.
   *
   * For a choice whose options need to be *compared* rather than merely named —
   * the six one-rep-max formulas, which are six surnames until something says
   * what they do differently. Left off, the row is a single line and sits at the
   * same height it always did.
   */
  description?: string;
}

// ---------------------------------------------------------------------------
// OptionList
// ---------------------------------------------------------------------------

export interface OptionListProps<T extends string> {
  options: readonly ListPickerOption<T>[];
  value: T;
  /** Called with the chosen value. The caller closes the sheet. */
  onChange: (value: T) => void;
}

/**
 * The body of a single-choice sheet: one radio row per option, checkmark on the
 * selected one.
 *
 * Split out of `ListPicker` because the settings screen needs the same sheet
 * hung off a *list row* rather than off a pill — same options, same reading
 * order, same checkmark — and two hand-rolled radio lists in one app is how a
 * picker ends up with two different row heights depending on which screen
 * opened it.
 *
 * It scrolls itself. `FilterSheet` caps its own height at 80% of the window, so
 * a list long enough to reach that cap would otherwise be silently cut off at
 * the bottom with no indication that anything was below it. `flexGrow: 0` keeps
 * a short list sized to its content rather than stretching to fill the sheet.
 */
export function OptionList<T extends string>({ options, value, onChange }: OptionListProps<T>) {
  const colors = useColors();

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.options}>
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <View key={option.value}>
            {index > 0 && <Divider />}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              // The description is read as a hint rather than folded into the
              // label: it qualifies the option, it does not name it, and a
              // reader working down six of these wants the six names first.
              accessibilityHint={option.description}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <View style={styles.optionBody}>
                <Text variant="body" style={selected ? { color: colors.accent } : undefined}>
                  {option.label}
                </Text>
                {option.description && (
                  <Text variant="caption" color="textTertiary">
                    {option.description}
                  </Text>
                )}
              </View>
              {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// ListPicker
// ---------------------------------------------------------------------------

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
        <OptionList
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
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
  list: { flexGrow: 0 },
  options: { paddingBottom: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    // Real padding rather than a bare `minHeight`, because a described option is
    // two lines tall and has to breathe at the same rate as a one-line one.
    paddingVertical: spacing.sm,
    minHeight: controlHeight.md + 4,
  },
  optionBody: { flex: 1, gap: 2 },
});
