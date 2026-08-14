import {
  EQUIPMENT_LABELS,
  formatDurationShort,
  formatVolume,
  formatWeight,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  repMaxTable,
  type PrKind,
  type SetLike,
} from '@lift/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Chip, Divider, EmptyState, Screen, SectionHeader, Text } from '@/components/ui';
import { db } from '@/db/client';
import {
  personalRecords,
  workoutExercises,
  workoutSets,
  workouts,
  type Exercise,
  type WorkoutSet,
} from '@/db/schema';
import { ExerciseMedia } from '@/features/exercises/exercise-media';
import { deleteExercise, getExercise } from '@/features/exercises/repository';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

interface HistoryEntry {
  workoutId: string;
  workoutName: string;
  performedAt: Date;
  sets: WorkoutSet[];
}

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { weightUnit, oneRepMaxFormula, bodyweightKg } = useSettings();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [records, setRecords] = useState<{ kind: PrKind; value: number }[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await getExercise(id);
      if (cancelled) return;
      setExercise(loaded ?? null);
      if (!loaded) return;

      // Most recent sessions containing this exercise.
      const links = await db
        .select({
          linkId: workoutExercises.id,
          workoutId: workouts.id,
          workoutName: workouts.name,
          startedAt: workouts.startedAt,
        })
        .from(workoutExercises)
        .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
        .where(
          and(
            eq(workoutExercises.exerciseId, id),
            isNotNull(workouts.finishedAt),
            isNull(workouts.deletedAt),
            isNull(workoutExercises.deletedAt),
          ),
        )
        .orderBy(desc(workouts.startedAt))
        .limit(20);

      const entries: HistoryEntry[] = [];
      for (const link of links) {
        const sets = await db
          .select()
          .from(workoutSets)
          .where(and(eq(workoutSets.workoutExerciseId, link.linkId), isNull(workoutSets.deletedAt)))
          .orderBy(workoutSets.position);

        entries.push({
          workoutId: link.workoutId,
          workoutName: link.workoutName,
          performedAt: link.startedAt,
          sets,
        });
      }

      const prRows = await db
        .select()
        .from(personalRecords)
        .where(and(eq(personalRecords.exerciseId, id), isNull(personalRecords.deletedAt)));

      // Keep only the best value per kind.
      const bestByKind = new Map<PrKind, number>();
      for (const row of prRows) {
        if (row.value > (bestByKind.get(row.kind) ?? 0)) bestByKind.set(row.kind, row.value);
      }

      if (!cancelled) {
        setHistory(entries);
        setRecords([...bestByKind].map(([kind, value]) => ({ kind, value })));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!exercise) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Exercise' }} />
      </Screen>
    );
  }

  const allSets = history.flatMap((entry) => entry.sets) as SetLike[];
  const repMaxes = repMaxTable(
    allSets,
    { trackingType: exercise.trackingType, bodyweightKg: bodyweightKg ?? undefined, formula: oneRepMaxFormula },
    10,
  );

  const confirmDelete = () => {
    const isCustom = exercise.isCustom;
    Alert.alert(
      isCustom ? 'Delete exercise' : 'Archive exercise',
      isCustom
        ? 'This removes the exercise. Past workouts keep their history.'
        : 'Built-in exercises are archived rather than deleted, so they stay out of pickers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isCustom ? 'Delete' : 'Archive',
          style: 'destructive',
          onPress: () => void deleteExercise(id).then(() => router.back()),
        },
      ],
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: exercise.name,
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={8}>
              <Text variant="label" color="danger">
                {exercise.isCustom ? 'Delete' : 'Archive'}
              </Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.media}>
          <ExerciseMedia
            name={exercise.name}
            thumbnailUrl={exercise.thumbnailUrl}
            videoUrl={exercise.videoUrl}
          />
        </View>

        <View style={styles.chips}>
          <Chip label={MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} selected />
          <Chip label={EQUIPMENT_LABELS[exercise.equipment]} />
          {exercise.secondaryMuscles.map((muscle) => (
            <Chip key={muscle} label={MUSCLE_GROUP_LABELS[muscle]} />
          ))}
        </View>

        {records.length > 0 && (
          <>
            <SectionHeader title="Personal Records" />
            <Card style={styles.card}>
              {records.map((record) => (
                <View key={record.kind} style={styles.recordRow}>
                  <Text variant="label" color="textSecondary">
                    {PR_KIND_LABELS[record.kind]}
                  </Text>
                  <Text variant="numeric" color="record">
                    {formatRecord(record.kind, record.value, weightUnit)}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {repMaxes.size > 0 && (
          <>
            <SectionHeader title="Rep Maxes" />
            <Card style={styles.card}>
              {[...repMaxes]
                .sort((a, b) => a[0] - b[0])
                .map(([reps, weight]) => (
                  <View key={reps} style={styles.recordRow}>
                    <Text variant="label" color="textSecondary">
                      {reps} {reps === 1 ? 'rep' : 'reps'}
                    </Text>
                    <Text variant="numeric">
                      {formatWeight(weight, weightUnit, { decimals: 1 })}
                    </Text>
                  </View>
                ))}
            </Card>
          </>
        )}

        <SectionHeader title="History" />
        {history.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="No history yet"
            description="Log this exercise in a workout and it'll show up here."
          />
        ) : (
          history.map((entry) => (
            <Card key={entry.workoutId} style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <Text variant="bodyMedium" numberOfLines={1} style={styles.flex}>
                  {entry.workoutName}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {entry.performedAt.toLocaleDateString()}
                </Text>
              </View>
              <Divider />
              {entry.sets.map((set, index) => (
                <View key={set.id} style={styles.historySet}>
                  <Text variant="label" color="textTertiary">
                    {index + 1}
                  </Text>
                  <Text variant="label">
                    {set.weightKg != null
                      ? formatWeight(set.weightKg, weightUnit, { decimals: 1 })
                      : '—'}
                    {set.reps != null ? ` × ${set.reps}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function formatRecord(kind: PrKind, value: number, unit: 'kg' | 'lb'): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      return `${value.toFixed(2)} km`;
    case 'best_set_volume':
    case 'best_session_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  media: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  card: { marginHorizontal: spacing.lg, gap: spacing.sm },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  historySet: { flexDirection: 'row', gap: spacing.lg },
  flex: { flex: 1 },
});
