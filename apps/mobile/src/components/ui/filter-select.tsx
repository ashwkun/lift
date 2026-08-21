import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { controlHeight, HIT_SLOP, radius, spacing, stroke, useColors } from '@/theme';

import { Button } from './button';
import { useSheetLayout } from './sheet-layout';
import { Divider } from './surfaces';
import { Text } from './text';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** How many rows match, shown alongside the label. */
  count?: number;
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export interface FilterTriggerProps {
  /** Names the dimension, e.g. "Muscle". Shown when nothing is selected. */
  label: string;
  /** What the trigger reads while something is selected. */
  summary?: string | null;
  expanded?: boolean;
  onPress: () => void;
}

/**
 * The pill that opens a filter sheet.
 *
 * Split out of `FilterSelect` because the muscle filter draws a body map rather
 * than a list of options, and a filter bar whose two controls didn't match
 * would read as two unrelated things.
 */
export function FilterTrigger({ label, summary, expanded = false, onPress }: FilterTriggerProps) {
  const colors = useColors();
  const active = Boolean(summary);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={active ? `${label}: ${summary}` : `Filter by ${label}`}
      onPress={onPress}
      style={({ pressed }) => {
        const fill = active
          ? colors.accentSurface
          : pressed
            ? colors.surfacePressed
            : colors.surfaceMuted;

        // Inactive, the outline is the fill: the border is drawn in every
        // state, so the pill holds one width, and a transparent stroke around
        // a radius seams on Android. See `stroke` in the tokens.
        return [styles.trigger, { backgroundColor: fill, borderColor: active ? colors.accent : fill }];
      }}
    >
      <Text
        variant="label"
        numberOfLines={1}
        style={{ color: active ? colors.accent : colors.textSecondary }}
      >
        {active ? summary : label}
      </Text>
      <Ionicons name="chevron-down" size={14} color={active ? colors.accent : colors.textTertiary} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export interface FilterSheetProps {
  visible: boolean;
  /** The dimension being filtered, shown as the sheet's heading. */
  label: string;
  onClose: () => void;
  /** Clears the dimension. Omitted when nothing is selected. */
  onClear?: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet chrome shared by every filter dimension.
 *
 * Owns the modal, the backdrop, the heading and the two ways out — so a sheet
 * full of checkboxes and a sheet holding a body map dismiss identically.
 */
export function FilterSheet({ visible, label, onClose, onClear, children }: FilterSheetProps) {
  const colors = useColors();
  const sheetLayout = useSheetLayout();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
        style={[styles.backdrop, { backgroundColor: colors.overlay }, sheetLayout.backdrop]}
        onPress={onClose}
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
              // Docked to the bottom edge, the footer would otherwise sit under
              // the gesture pill. Centred, there is no pill to clear — see
              // `bottomInset`.
              paddingBottom: spacing.md + sheetLayout.bottomInset,
            },
            sheetLayout.sheet,
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          {/*
            The close button is the sheet's only dismissal for anyone not
            using the backdrop: tapping the dim area has no screen reader
            equivalent, and it is also the part sighted users have to guess
            at. It names the dimension it closes, since "Close" alone reads
            the same on every filter in the bar.
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
            {onClear && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clear ${label.toLowerCase()} filter`}
                onPress={onClear}
                hitSlop={HIT_SLOP}
                style={({ pressed }) => [
                  styles.clear,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <Text variant="label" color="accent">
                  Clear
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${label.toLowerCase()} filter`}
              onPress={onClose}
              hitSlop={HIT_SLOP}
              style={({ pressed }) => [
                styles.close,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FilterSelect
// ---------------------------------------------------------------------------

export interface FilterSelectProps<T extends string> {
  /** Shown when nothing is selected, e.g. "Equipment". */
  label: string;
  values: readonly T[];
  options: readonly FilterOption<T>[];
  onChange: (values: T[]) => void;
}

/**
 * One filter dimension, as a compact trigger that opens a multi-select sheet.
 *
 * This replaced a horizontal strip of chips — one per possible value. That was
 * fine for a curated library, but the catalog populates all 21 muscle groups
 * and 12 equipment types, so the strip became 33 identically-styled chips in
 * one scrolling run with nothing to distinguish a muscle from a piece of
 * equipment. A trigger per dimension stays one line however many values exist,
 * and names the dimension the value belongs to.
 *
 * Selecting is additive: "Barbell **or** Dumbbell" is the question people
 * actually ask in a gym where half the racks are taken, and a single-value
 * filter made them run the search twice. Rows therefore toggle in place rather
 * than dismissing the sheet — the trip is worth making once, not once per
 * value — and Done is what closes it.
 */
export function FilterSelect<T extends string>({
  label,
  values,
  options,
  onChange,
}: FilterSelectProps<T>) {
  const [open, setOpen] = useState(false);

  const selected = new Set(values);
  const summary = summarise(label, values, options);

  const toggle = (value: T) => {
    const next = new Set(selected);
    // `delete` reports whether it was there, so this is one lookup, not two.
    if (!next.delete(value)) next.add(value);
    // Ordered by the option list rather than by tap order, so the summary and
    // the sheet agree about which value is "the" one when exactly one is on.
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

  return (
    <>
      <FilterTrigger
        label={label}
        summary={summary}
        expanded={open}
        onPress={() => setOpen(true)}
      />

      <FilterSheet
        visible={open}
        label={label}
        onClose={() => setOpen(false)}
        onClear={values.length > 0 ? () => onChange([]) : undefined}
      >
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {options.map((option, index) => (
            <View key={option.value}>
              {index > 0 && <Divider />}
              <OptionRow
                label={option.label}
                count={option.count}
                selected={selected.has(option.value)}
                onPress={() => toggle(option.value)}
              />
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Done" fullWidth onPress={() => setOpen(false)} />
        </View>
      </FilterSheet>
    </>
  );
}

/**
 * What the trigger says once something is on.
 *
 * A single value names itself — "Barbell" is more useful than "Equipment · 1",
 * and it is the common case. Past that the pill has no room for a list, so it
 * falls back to the dimension and a count.
 */
function summarise<T extends string>(
  label: string,
  values: readonly T[],
  options: readonly FilterOption<T>[],
): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) {
    return options.find((option) => option.value === values[0])?.label ?? label;
  }
  return `${label} · ${values.length}`;
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
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={20}
        color={selected ? colors.accent : colors.textTertiary}
      />
      <Text variant="body" style={[styles.optionLabel, selected && { color: colors.accent }]}>
        {label}
      </Text>
      {count !== undefined && (
        <Text variant="caption" color="textTertiary">
          {count}
        </Text>
      )}
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
    borderWidth: stroke.outline,
  },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    // Capped rather than sized to content: 21 muscle groups would otherwise
    // reach the status bar.
    maxHeight: '80%',
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
  clear: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
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
  listContent: { paddingBottom: spacing.sm },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: controlHeight.md + 4,
  },
  optionLabel: { flex: 1 },
});
