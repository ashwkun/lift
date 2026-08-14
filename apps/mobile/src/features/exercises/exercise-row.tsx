import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT_LABELS, MUSCLE_GROUP_LABELS } from '@ironlog/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { Exercise } from '@/db/schema';
import { radius, spacing, useColors } from '@/theme';

export interface ExerciseRowProps {
  exercise: Exercise;
  onPress?: (exercise: Exercise) => void;
  /** Shows a checkbox instead of a chevron, for multi-select pickers. */
  selectable?: boolean;
  selected?: boolean;
  /** Small badge on the right, e.g. how many times it's already been added. */
  badge?: string;
}

/**
 * Two initials derived from the exercise name, used as a cheap visual anchor in
 * place of the illustrated thumbnails Hevy ships. Skips the parenthesised
 * equipment qualifier so "Bench Press (Barbell)" reads "BP", not "BB".
 */
function initialsFor(name: string): string {
  const base = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export const ExerciseRow = memo(function ExerciseRow({
  exercise,
  onPress,
  selectable = false,
  selected = false,
  badge,
}: ExerciseRowProps) {
  const colors = useColors();

  const subtitle = `${MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} · ${
    EQUIPMENT_LABELS[exercise.equipment]
  }`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selectable ? { selected } : undefined}
      onPress={() => onPress?.(exercise)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <View
        style={[
          styles.avatar,
          {
            backgroundColor: selected ? colors.accent : colors.surfaceMuted,
          },
        ]}
      >
        <Text
          variant="label"
          style={{ color: selected ? colors.textOnAccent : colors.textSecondary }}
        >
          {initialsFor(exercise.name)}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text variant="bodyMedium" numberOfLines={1} style={styles.title}>
            {exercise.name}
          </Text>
          {exercise.isCustom && (
            <View style={[styles.customTag, { backgroundColor: colors.accentSurface }]}>
              <Text variant="caption" color="accent">
                Custom
              </Text>
            </View>
          )}
        </View>
        <Text variant="label" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption" color="textSecondary">
            {badge}
          </Text>
        </View>
      ) : null}

      {selectable ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.accent : colors.textTertiary}
        />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  customTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  badge: {
    minWidth: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
});
