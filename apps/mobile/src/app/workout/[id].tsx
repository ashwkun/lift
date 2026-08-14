import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  formatWeight,
  isWorkingSet,
  SET_TYPE_BADGE,
} from '@ironlog/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Divider, PromptModal, Screen, Text } from '@/components/ui';
import { db } from '@/db/client';
import { touch, trackDelete, trackUpsertCoalesced } from '@/db/mutations';
import { personalRecords, workouts } from '@/db/schema';
import { getWorkoutDetail, type WorkoutDetail } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [prSetIds, setPrSetIds] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);

  const reload = useCallback(async () => {
    const loaded = await getWorkoutDetail(id);
    setDetail(loaded ?? null);

    const records = await db
      .select({ setId: personalRecords.setId })
      .from(personalRecords)
      .where(and(eq(personalRecords.workoutId, id), isNull(personalRecords.deletedAt)));

    setPrSetIds(new Set(records.map((row) => row.setId).filter((value): value is string => !!value)));
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rename = async (name: string) => {
    await db
      .update(workouts)
      .set({ name, ...touch() })
      .where(eq(workouts.id, id));

    const [updated] = await db.select().from(workouts).where(eq(workouts.id, id)).limit(1);
    if (updated) {
      await trackUpsertCoalesced('workouts', {
        ...updated,
        startedAt: updated.startedAt.getTime(),
        finishedAt: updated.finishedAt?.getTime() ?? null,
      });
    }
    await reload();
  };

  const confirmDelete = () => {
    Alert.alert('Delete workout', 'This session and its sets will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const deletedAt = Date.now();
            await db
              .update(workouts)
              .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
              .where(eq(workouts.id, id));
            await trackDelete('workouts', id, deletedAt);
            router.back();
          })();
        },
      },
    ]);
  };

  if (!detail) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Workout' }} />
      </Screen>
    );
  }

  const { workout, exercises } = detail;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete workout">
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => setRenaming(true)} style={styles.titleBlock}>
          <Text variant="heading">{workout.name}</Text>
          <Text variant="label" color="textSecondary">
            {workout.startedAt.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </Pressable>

        <Card style={styles.stats}>
          <Stat label="Duration" value={formatDurationShort(workout.durationSeconds ?? 0)} />
          <Stat label="Volume" value={formatVolume(workout.totalVolumeKg, weightUnit)} />
          <Stat label="Sets" value={String(workout.totalSets)} />
          <Stat label="Records" value={String(workout.prCount)} />
        </Card>

        {workout.notes ? (
          <Card style={styles.notes}>
            <Text variant="label" color="textSecondary">
              {workout.notes}
            </Text>
          </Card>
        ) : null}

        {exercises.map((entry) => {
          let workingIndex = 0;

          return (
            <Card key={entry.workoutExercise.id} style={styles.exerciseCard}>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/exercise/[id]', params: { id: entry.exercise.id } })
                }
              >
                <Text variant="bodyMedium" color="accent" numberOfLines={1}>
                  {entry.exercise.name}
                </Text>
              </Pressable>

              {entry.workoutExercise.notes ? (
                <Text variant="caption" color="textSecondary">
                  {entry.workoutExercise.notes}
                </Text>
              ) : null}

              <Divider />

              {entry.sets.map((set) => {
                if (isWorkingSet(set.setType)) workingIndex += 1;
                const badge = SET_TYPE_BADGE[set.setType];
                const isPr = prSetIds.has(set.id);

                return (
                  <View key={set.id} style={styles.setRow}>
                    <Text variant="label" color="textTertiary" style={styles.setIndex}>
                      {badge ?? workingIndex}
                    </Text>
                    <Text variant="label" style={styles.setValue}>
                      {set.weightKg != null
                        ? formatWeight(set.weightKg, weightUnit, { decimals: 1 })
                        : '—'}
                      {set.reps != null ? ` × ${set.reps}` : ''}
                    </Text>
                    {isPr && <Ionicons name="trophy" size={13} color={colors.record} />}
                  </View>
                );
              })}
            </Card>
          );
        })}

        <Button
          title="Repeat Workout"
          variant="secondary"
          fullWidth
          onPress={() =>
            Alert.alert(
              'Repeat workout',
              'Creating routines from past workouts is coming next.',
            )
          }
          style={styles.repeat}
        />
      </ScrollView>

      <PromptModal
        visible={renaming}
        title="Rename workout"
        initialValue={workout.name}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          setRenaming(false);
          void rename(value);
        }}
      />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" color="textTertiary">
        {label}
      </Text>
      <Text variant="numeric">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  titleBlock: { gap: spacing.xs },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { gap: 2 },
  notes: {},
  exerciseCard: { gap: spacing.sm },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  setIndex: { width: 20 },
  setValue: { flex: 1 },
  repeat: { marginTop: spacing.lg },
});
