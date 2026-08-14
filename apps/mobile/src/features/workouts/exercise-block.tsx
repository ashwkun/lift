import { Ionicons } from '@expo/vector-icons';
import { isWorkingSet, TRACKING_FIELDS, type SetType } from '@ironlog/shared';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

import { SetRow } from './set-row';
import type { WorkoutExerciseDetail } from './repository';

export interface ExerciseBlockProps {
  detail: WorkoutExerciseDetail;
  previousSets: WorkoutSet[];
  onAddSet: () => void;
  onUpdateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  onToggleSet: (set: WorkoutSet) => void;
  onDeleteSet: (setId: string) => void;
  onChangeSetType: (setId: string, setType: SetType) => void;
  onRemoveExercise: () => void;
  onEditNotes: () => void;
}

export function ExerciseBlock({
  detail,
  previousSets,
  onAddSet,
  onUpdateSet,
  onToggleSet,
  onDeleteSet,
  onChangeSetType,
  onRemoveExercise,
  onEditNotes,
}: ExerciseBlockProps) {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const fields = TRACKING_FIELDS[detail.exercise.trackingType];

  // Warm-ups don't consume a working-set number, so the visible ordinal has to
  // be counted separately from the array index.
  let workingCounter = 0;

  const confirmRemove = () => {
    Alert.alert('Remove exercise', `Remove ${detail.exercise.name} from this workout?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onRemoveExercise },
    ]);
  };

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Pressable style={styles.titleRow} onPress={onEditNotes}>
          <Text variant="bodyMedium" color="accent" numberOfLines={1}>
            {detail.exercise.name}
          </Text>
        </Pressable>
        <Pressable
          onPress={confirmRemove}
          hitSlop={8}
          accessibilityLabel={`Remove ${detail.exercise.name}`}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {detail.workoutExercise.notes ? (
        <Pressable onPress={onEditNotes} style={styles.notes}>
          <Text variant="label" color="textSecondary">
            {detail.workoutExercise.notes}
          </Text>
        </Pressable>
      ) : null}

      {/* Column headings */}
      <View style={styles.columnHeader}>
        <Text variant="caption" color="textTertiary" style={styles.indexCell}>
          SET
        </Text>
        <Text variant="caption" color="textTertiary" style={styles.previousCell}>
          PREVIOUS
        </Text>
        {fields.weight && (
          <Text variant="caption" color="textTertiary" style={styles.unitCell}>
            {weightUnit.toUpperCase()}
          </Text>
        )}
        {fields.duration && (
          <Text variant="caption" color="textTertiary" style={styles.unitCell}>
            TIME
          </Text>
        )}
        {fields.distance && (
          <Text variant="caption" color="textTertiary" style={styles.unitCell}>
            KM
          </Text>
        )}
        {fields.reps && (
          <Text variant="caption" color="textTertiary" style={styles.unitCell}>
            REPS
          </Text>
        )}
        <View style={styles.checkSpacer} />
      </View>

      {detail.sets.map((set, index) => {
        if (isWorkingSet(set.setType)) workingCounter += 1;

        return (
          <SetRow
            key={set.id}
            set={set}
            workingIndex={workingCounter}
            trackingType={detail.exercise.trackingType}
            previous={previousSets[index]}
            onChange={(patch) => onUpdateSet(set.id, patch)}
            onToggleComplete={() => onToggleSet(set)}
            onDelete={() => onDeleteSet(set.id)}
            onChangeSetType={(setType) => onChangeSetType(set.id, setType)}
          />
        );
      })}

      <Pressable
        onPress={onAddSet}
        style={({ pressed }) => [
          styles.addSet,
          { backgroundColor: colors.surfaceMuted },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={16} color={colors.textSecondary} />
        <Text variant="label" color="textSecondary">
          Add Set
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { paddingVertical: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  titleRow: { flex: 1 },
  notes: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  indexCell: { width: 32, textAlign: 'center' },
  previousCell: { flex: 1, minWidth: 60 },
  unitCell: { width: 62, textAlign: 'center' },
  checkSpacer: { width: 38 },
  addSet: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    height: 34,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pressed: { opacity: 0.6 },
});
