import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  formatWeight,
  isWorkingSet,
  PR_KIND_LABELS,
  type PrKind,
} from '@ironlog/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { db } from '@/db/client';
import { personalRecords } from '@/db/schema';
import { getWorkoutDetail, type WorkoutDetail } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

interface PrSummary {
  kind: PrKind;
  value: number;
  exerciseName: string;
}

export default function WorkoutSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [prs, setPrs] = useState<PrSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await getWorkoutDetail(id);
      if (cancelled || !loaded) return;
      setDetail(loaded);

      const records = await db
        .select()
        .from(personalRecords)
        .where(and(eq(personalRecords.workoutId, id), isNull(personalRecords.deletedAt)));

      const nameById = new Map(
        loaded.exercises.map((entry) => [entry.exercise.id, entry.exercise.name]),
      );

      if (!cancelled) {
        setPrs(
          records.map((record) => ({
            kind: record.kind,
            value: record.value,
            exerciseName: nameById.get(record.exerciseId) ?? 'Exercise',
          })),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!detail) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Summary' }} />
      </Screen>
    );
  }

  const { workout, exercises } = detail;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Workout Complete',
          // Back would return to the now-finished logging screen, so the only
          // way out is forward.
          headerBackVisible: false,
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accentSurface }]}>
            <Ionicons name="checkmark" size={34} color={colors.accent} />
          </View>
          <Text variant="heading" align="center">
            {workout.name}
          </Text>
          <Text variant="body" color="textSecondary" align="center">
            {workout.startedAt.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>

        <Card style={styles.statsCard}>
          <Stat label="Duration" value={formatDurationShort(workout.durationSeconds ?? 0)} />
          <Stat label="Volume" value={formatVolume(workout.totalVolumeKg, weightUnit)} />
          <Stat label="Sets" value={String(workout.totalSets)} />
          <Stat label="Reps" value={String(workout.totalReps)} />
        </Card>

        {prs.length > 0 && (
          <Card style={[styles.prCard, { borderColor: colors.record }]}>
            <View style={styles.prHeader}>
              <Ionicons name="trophy" size={18} color={colors.record} />
              <Text variant="bodyMedium" color="record">
                {prs.length} Personal {prs.length === 1 ? 'Record' : 'Records'}
              </Text>
            </View>
            {prs.map((pr, index) => (
              <View key={`${pr.kind}-${index}`} style={styles.prRow}>
                <Text variant="label" numberOfLines={1} style={styles.prName}>
                  {pr.exerciseName}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {PR_KIND_LABELS[pr.kind]}
                </Text>
                <Text variant="numeric" color="record">
                  {formatPrValue(pr.kind, pr.value, weightUnit)}
                </Text>
              </View>
            ))}
          </Card>
        )}

        <View style={styles.exerciseList}>
          {exercises.map((entry) => {
            const working = entry.sets.filter((set) => isWorkingSet(set.setType));
            return (
              <View key={entry.workoutExercise.id} style={styles.exerciseRow}>
                <Text variant="bodyMedium" numberOfLines={1} style={styles.exerciseName}>
                  {entry.exercise.name}
                </Text>
                <Text variant="label" color="textSecondary">
                  {working.length} {working.length === 1 ? 'set' : 'sets'}
                </Text>
              </View>
            );
          })}
        </View>

        <Button
          title="Done"
          size="lg"
          fullWidth
          onPress={() => router.replace('/(tabs)')}
          style={styles.done}
        />
      </ScrollView>
    </Screen>
  );
}

function formatPrValue(kind: PrKind, value: number, unit: 'kg' | 'lb'): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      return `${value.toFixed(2)} km`;
    case 'best_session_volume':
    case 'best_set_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
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
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statsCard: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { gap: 2 },
  prCard: { gap: spacing.sm, borderWidth: 1 },
  prHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prName: { flex: 1 },
  exerciseList: { gap: spacing.sm },
  exerciseRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  exerciseName: { flex: 1 },
  done: { marginTop: spacing.lg },
});
