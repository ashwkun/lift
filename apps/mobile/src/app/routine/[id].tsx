import { Ionicons } from '@expo/vector-icons';
import { fromDisplayWeight, toDisplayWeight } from '@ironlog/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Divider, EmptyState, NumericField, Screen, Text } from '@/components/ui';
import {
  addExerciseToRoutine,
  addRoutineSet,
  deleteRoutine,
  deleteRoutineSet,
  getRoutineDetail,
  removeExerciseFromRoutine,
  updateRoutine,
  updateRoutineSet,
  type RoutineDetail,
} from '@/features/routines/repository';
import { startWorkout } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

export default function RoutineEditorScreen() {
  const { id, addedExerciseIds } = useLocalSearchParams<{
    id: string;
    addedExerciseIds?: string;
  }>();

  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [detail, setDetail] = useState<RoutineDetail | null>(null);

  const reload = useCallback(async () => {
    setDetail((await getRoutineDetail(id)) ?? null);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Exercises picked in the modal arrive as a route param.
  useEffect(() => {
    if (!addedExerciseIds) return;

    void (async () => {
      for (const exerciseId of addedExerciseIds.split(',').filter(Boolean)) {
        await addExerciseToRoutine(id, exerciseId);
      }
      router.setParams({ addedExerciseIds: undefined });
      await reload();
    })();
  }, [addedExerciseIds, id, reload]);

  const confirmDelete = () => {
    Alert.alert('Delete routine', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteRoutine(id);
            router.back();
          })();
        },
      },
    ]);
  };

  if (!detail) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Routine' }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: detail.routine.name,
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete routine">
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.nameField}>
          <Text variant="caption" color="textTertiary">
            ROUTINE NAME
          </Text>
          <Pressable
            onPress={() => {
              Alert.prompt?.(
                'Rename routine',
                undefined,
                (value) => {
                  if (value?.trim()) {
                    void updateRoutine(id, { name: value.trim() }).then(reload);
                  }
                },
                'plain-text',
                detail.routine.name,
              );
            }}
          >
            <Text variant="subheading">{detail.routine.name}</Text>
          </Pressable>
        </View>

        {detail.exercises.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No exercises"
            description="Add exercises and prescribe their target sets."
          />
        ) : (
          detail.exercises.map((entry, index) => (
            <View key={entry.routineExercise.id}>
              {index > 0 && <Divider />}

              <View style={styles.exerciseHeader}>
                <Text variant="bodyMedium" color="accent" numberOfLines={1} style={styles.flex}>
                  {entry.exercise.name}
                </Text>
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={`Remove ${entry.exercise.name}`}
                  onPress={() => {
                    void removeExerciseFromRoutine(entry.routineExercise.id).then(reload);
                  }}
                >
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.columnHeader}>
                <Text variant="caption" color="textTertiary" style={styles.setCell}>
                  SET
                </Text>
                <Text variant="caption" color="textTertiary" style={styles.targetCell}>
                  {weightUnit.toUpperCase()}
                </Text>
                <Text variant="caption" color="textTertiary" style={styles.targetCell}>
                  REPS
                </Text>
                <View style={styles.removeSpacer} />
              </View>

              {entry.sets.map((set, setIndex) => (
                <View key={set.id} style={styles.setRow}>
                  <Text variant="numeric" color="textSecondary" style={styles.setCell}>
                    {setIndex + 1}
                  </Text>
                  <NumericField
                    value={
                      set.targetWeightKg == null
                        ? ''
                        : String(Math.round(toDisplayWeight(set.targetWeightKg, weightUnit) * 10) / 10)
                    }
                    placeholder="—"
                    onChangeText={(text) => {
                      const parsed = text === '' ? null : Number(text.replace(',', '.'));
                      if (parsed !== null && !Number.isFinite(parsed)) return;
                      void updateRoutineSet(set.id, {
                        targetWeightKg:
                          parsed === null ? null : fromDisplayWeight(parsed, weightUnit),
                      }).then(reload);
                    }}
                  />
                  <NumericField
                    value={set.targetReps == null ? '' : String(set.targetReps)}
                    placeholder="—"
                    keyboardType="number-pad"
                    onChangeText={(text) => {
                      const parsed = text === '' ? null : Number.parseInt(text, 10);
                      if (parsed !== null && !Number.isFinite(parsed)) return;
                      void updateRoutineSet(set.id, { targetReps: parsed }).then(reload);
                    }}
                  />
                  <Pressable
                    hitSlop={8}
                    accessibilityLabel={`Delete set ${setIndex + 1}`}
                    onPress={() => void deleteRoutineSet(set.id).then(reload)}
                    style={styles.removeSpacer}
                  >
                    <Ionicons name="remove-circle-outline" size={20} color={colors.textTertiary} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                onPress={() => {
                  const last = entry.sets[entry.sets.length - 1];
                  void addRoutineSet(entry.routineExercise.id, {
                    targetReps: last?.targetReps ?? null,
                    targetWeightKg: last?.targetWeightKg ?? null,
                  }).then(reload);
                }}
                style={[styles.addSet, { backgroundColor: colors.surfaceMuted }]}
              >
                <Ionicons name="add" size={16} color={colors.textSecondary} />
                <Text variant="label" color="textSecondary">
                  Add Set
                </Text>
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.actions}>
          <Button
            title="Add Exercise"
            icon="add"
            fullWidth
            onPress={() => router.push('/exercise/picker')}
          />
          <Button
            title="Start Routine"
            variant="success"
            fullWidth
            disabled={detail.exercises.length === 0}
            onPress={() => {
              void (async () => {
                await startWorkout({ routineId: id });
                router.push('/workout/active');
              })();
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  nameField: { padding: spacing.lg, gap: spacing.xs },
  flex: { flex: 1 },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  setCell: { width: 32, textAlign: 'center' },
  targetCell: { width: 62, textAlign: 'center' },
  removeSpacer: { width: 32, alignItems: 'center' },
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
  actions: { padding: spacing.lg, gap: spacing.sm, marginTop: spacing.lg },
});
