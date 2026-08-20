import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  formatWeight,
  isWorkingSet,
  PR_KIND_LABELS,
  type PrKind,
} from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Confetti } from '@/components/celebration/confetti';
import { Button, Card, Screen, splitMeasure, Text } from '@/components/ui';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { db } from '@/db/client';
import { personalRecords } from '@/db/schema';
import { getWorkoutDetail, type WorkoutDetail } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';
import { spacing, stroke, useColors } from '@/theme';

interface PrSummary {
  kind: PrKind;
  value: number;
  exerciseName: string;
}

export default function WorkoutSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);
  const reduceMotion = useReduceMotion();

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

  // Declared once and rendered in both branches. A native-stack screen reads
  // its options as the push animation starts, so setting them only in the
  // loaded branch meant the header slid in labelled "Summary" and relabelled
  // itself a beat later, mid-transition.
  const header = (
    <Stack.Screen
      options={{
        title: 'Workout complete',
        // Back would return to the now-finished logging screen, so the only
        // way out is forward.
        headerBackVisible: false,
      }}
    />
  );

  if (!detail) return <Screen>{header}</Screen>;

  const { workout, exercises } = detail;

  // Gold-led: this burst only ever runs for a record.
  const confettiColors = [colors.record, colors.warning, colors.success, colors.accent];

  return (
    <Screen>
      {header}

      {/* Records only. Firing on every finished session made the burst mean
          "you stopped logging", which is not an achievement — and it left the
          app with nothing louder to say on the day someone actually beat a
          number. It mounts when the record query resolves, so the burst lands
          with the numbers rather than over an empty screen. */}
      {!reduceMotion && prs.length > 0 && (
        <Confetti runKey={prs.length} count={70} durationMs={3200} colors={confettiColors} />
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {/*
         * A colophon, not a trophy screen.
         *
         * The header already says "Workout complete"; a 72px lime disc with a
         * checkmark in it was the second time in one viewport that the screen
         * congratulated the user, and it pushed the numbers they actually came
         * for below the fold. The date leads as a tracked overline, the session
         * name is the headline, and the record itself starts immediately.
         */}
        <View style={styles.hero}>
          <Text variant="overline" color="textTertiary">
            {workout.startedAt.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
          <Text variant="title">{workout.name}</Text>
        </View>

        {/*
         * Records come before the totals.
         *
         * This is the one screen read sitting down, and on a session that set
         * one, the record is the only thing on it the user did not already
         * watch accumulate in the header for an hour. Under the four-figure
         * grid it was the fourth thing read and, on a short phone, below the
         * fold.
         */}
        {prs.length > 0 && (
          <Card style={[styles.prCard, { borderColor: colors.record }]}>
            <View style={styles.prHeader}>
              <Ionicons name="trophy" size={18} color={colors.record} />
              <Text variant="bodyMedium" color="record">
                {prs.length === 1 ? '1 personal record' : `${prs.length} personal records`}
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

        {/* Volume leads the grid: it is the figure the rest of the app treats
            as a session's size, and duration is the one number the user
            already watched tick over on the logging screen. */}
        <View style={styles.stats}>
          <Stat label="Volume" value={formatVolume(workout.totalVolumeKg, weightUnit)} />
          <Stat label="Duration" value={formatDurationShort(workout.durationSeconds ?? 0)} />
          <Stat label="Sets" value={String(workout.totalSets)} />
          <Stat label="Reps" value={String(workout.totalReps)} />
        </View>

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

/** Label above figure, on a hairline-ruled band — the same grid as `StatBand`. */
function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const [figure, unit] = splitMeasure(value);

  return (
    <View style={[styles.stat, { borderTopColor: colors.border }]}>
      <Text variant="overline" color="textTertiary">
        {label}
      </Text>
      <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
        {figure}
        {unit ? (
          <Text variant="label" color="textTertiary">
            {` ${unit}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  hero: { gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  // Two columns rather than four across: at `numericLarge` a four-up row makes
  // every figure shrink to fit, which is how four numbers end up at four
  // different sizes. The rules meet in the middle and read as a table.
  stats: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: {
    width: '50%',
    paddingRight: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    borderTopWidth: stroke.rule,
  },
  prCard: { gap: spacing.sm, borderWidth: stroke.outline },
  prHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prName: { flex: 1 },
  exerciseList: { gap: spacing.sm },
  exerciseRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  exerciseName: { flex: 1 },
  done: { marginTop: spacing.lg },
});
