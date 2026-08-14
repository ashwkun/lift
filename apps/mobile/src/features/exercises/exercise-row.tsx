import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT_LABELS, MUSCLE_GROUP_LABELS } from '@lift/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { ExerciseListItem } from '@/features/exercises/repository';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { radius, spacing, useColors } from '@/theme';

export interface ExerciseRowProps {
  // Narrowed to what the row draws, so list screens can select those columns
  // alone. A full `Exercise` still satisfies it.
  exercise: ExerciseListItem;
  onPress?: (exercise: ExerciseListItem) => void;
  /** Shows a checkbox instead of a chevron, for multi-select pickers. */
  selectable?: boolean;
  selected?: boolean;
  /** Small badge on the right, e.g. how many times it's already been added. */
  badge?: string;
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
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <ExerciseThumbnail
        name={exercise.name}
        url={exercise.thumbnailUrl}
        selected={selected}
        size={44}
      />

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
