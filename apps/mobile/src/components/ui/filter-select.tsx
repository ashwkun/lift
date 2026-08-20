import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { controlHeight, HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { Divider } from './surfaces';
import { Text } from './text';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** How many rows match, shown alongside the label. */
  count?: number;
}

export interface FilterSelectProps<T extends string> {
  /** Shown when nothing is selected, e.g. "Muscle". */
  label: string;
  value: T | null;
  options: readonly FilterOption<T>[];
  onChange: (value: T | null) => void;
  /** Label for the reset row at the top of the sheet. */
  allLabel?: string;
}

/**
 * A single filter dimension, as a compact trigger that opens a sheet.
 *
 * This replaced a horizontal strip of chips — one per possible value. That was
 * fine for a curated library, but the catalog populates all 21 muscle groups
 * and 12 equipment types, so the strip became 33 identically-styled chips in
 * one scrolling run with nothing to distinguish a muscle from a piece of
 * equipment. A trigger per dimension stays one line however many values exist,
 * and names the dimension the value belongs to.
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel = `All ${label.toLowerCase()}`,
}: FilterSelectProps<T>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);
  const active = selected !== undefined;

  const choose = (next: T | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={active ? `${label}: ${selected.label}` : `Filter by ${label}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: active
              ? colors.accentSurface
              : pressed
                ? colors.surfacePressed
                : colors.surfaceMuted,
            borderColor: active ? colors.accent : 'transparent',
          },
        ]}
      >
        <Text
          variant="label"
          numberOfLines={1}
          style={{ color: active ? colors.accent : colors.textSecondary }}
        >
          {active ? selected.label : label}
        </Text>
        <Ionicons
          name="chevron-down"
          size={14}
          color={active ? colors.accent : colors.textTertiary}
        />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/*
          `accessible={false}` on both Pressables, deliberately.

          Pressable defaults to `accessible`, which collapses everything under
          it into one element — so the backdrop announced the entire sheet as a
          single button reading all 21 muscle groups in a row, and no option
          inside it could be reached. This is the control that gates every
          search on the exercise library, so it cannot be a blob.
        */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setOpen(false)}
        >
          <Pressable
            accessible={false}
            // Hides the list behind the sheet from VoiceOver, so focus lands on
            // the sheet's own heading when it opens and a swipe past the last
            // option comes back to it.
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                // The sheet is anchored to the bottom edge, so its last option
                // would otherwise sit under the gesture pill.
                paddingBottom: spacing.md + insets.bottom,
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {/*
              The close button is the sheet's only dismissal for anyone not
              using the backdrop: tapping the dim area has no screen reader
              equivalent, and it is also the part sighted users have to guess
              at. It names the dimension it closes, since "Close" alone reads
              the same on both filters in the bar.
            */}
            <View style={styles.sheetHeader}>
              <Text
                variant="overline"
                color="textTertiary"
                accessibilityRole="header"
                style={styles.flex}
              >
                {label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${label.toLowerCase()} filter`}
                onPress={() => setOpen(false)}
                hitSlop={HIT_SLOP}
                style={({ pressed }) => [
                  styles.close,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              <OptionRow label={allLabel} selected={!active} onPress={() => choose(null)} />
              <Divider />
              {options.map((option) => (
                <OptionRow
                  key={option.value}
                  label={option.label}
                  count={option.count}
                  selected={option.value === value}
                  onPress={() => choose(option.value)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function OptionRow({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Text variant="body" style={[styles.optionLabel, selected && { color: colors.accent }]}>
        {label}
      </Text>
      {count !== undefined && (
        <Text variant="caption" color="textTertiary">
          {count}
        </Text>
      )}
      {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // `md`, not `sm`: the trigger sits in a free-standing filter bar, so nothing
    // around it carries the target the way a set row carries its stepper's. At
    // `sm` it measured 36pt, and it is the control that gates every search on
    // the exercise library.
    height: controlHeight.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    // Capped rather than sized to content: 21 muscle groups would otherwise
    // reach the status bar.
    maxHeight: '70%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.xl,
    // Shorter than the left: the close button carries its own inset, so the
    // full gutter would push it away from the edge the thumb reaches for.
    paddingRight: spacing.md,
    paddingBottom: spacing.sm,
  },
  flex: { flex: 1 },
  // 32 plus the standard 8pt slop is 48, and there is nothing pressable in any
  // direction for that slop to contest.
  close: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: controlHeight.md + 4,
  },
  optionLabel: { flex: 1 },
});
