import { Ionicons } from '@expo/vector-icons';
import {
  formatDateTime,
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
import { Button, Card, Screen, Text, splitMeasure, useScrollEdge } from '@/components/ui';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { db } from '@/db/client';
import { personalRecords } from '@/db/schema';
import {
  resolveExerciseUnits,
  useAppUnits,
  type ExerciseUnitOverrides,
} from '@/features/exercises/units';
import { getWorkoutDetail, type WorkoutDetail } from '@/features/workouts/repository';
import { spacing, stroke, useColors } from '@/theme';

/**
 * The colophon's date: no year, because this screen is only ever reached
 * seconds after the session it describes.
 */
const HERO_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

interface PrSummary {
  kind: PrKind;
  value: number;
  exerciseName: string;
  /**
   * The exercise's own unit, if it has one. A record is a fact about a single
   * movement, so it is printed in that movement's unit, while the volume total
   * three rows below stays in the app's, because it is a sum across exercises
   * that may not agree on one.
   */
  units: ExerciseUnitOverrides;
}

export default function WorkoutSummaryScreen() {
  const scrollEdge = useScrollEdge();

  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const appUnits = useAppUnits();
  const { weightUnit } = appUnits;
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

      const exerciseById = new Map(
        loaded.exercises.map((entry) => [entry.exercise.id, entry.exercise]),
      );

      if (!cancelled) {
        setPrs(
          records.map((record) => {
            const exercise = exerciseById.get(record.exerciseId);

            return {
              kind: record.kind,
              value: record.value,
              exerciseName: exercise?.name ?? 'Exercise',
              units: {
                weightUnit: exercise?.weightUnit ?? null,
                distanceUnit: exercise?.distanceUnit ?? null,
              },
            };
          }),
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
        //
        // And forward is the full-width Done at the foot of the content, not a
        // second copy of it up here. The consistency pass that filled Save,
        // Done and Log elsewhere deliberately left this header empty: a summary
        // is read top to bottom and ends on its own exit, so a header action
        // would be the same destination offered twice on one screen, and the
        // one in the content is the larger, more obvious target of the two.
        headerBackVisible: false,
      }}
    />
  );

  if (!detail) return <Screen scrolled={scrollEdge.progress}>{header}</Screen>;

  const { workout, exercises } = detail;

  // Gold-led: this burst only ever runs for a record.
  const confettiColors = [colors.record, colors.warning, colors.success, colors.accent];

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      {/* Records only. Firing on every finished session made the burst mean
          "you stopped logging", which is not an achievement, and it left the
          app with nothing louder to say on the day someone actually beat a
          number. It mounts when the record query resolves, so the burst lands
          with the numbers rather than over an empty screen. */}
      {!reduceMotion && prs.length > 0 && (
        <Confetti runKey={prs.length} count={70} durationMs={3200} colors={confettiColors} />
      )}

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
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
            {formatDateTime(workout.startedAt, HERO_DATE)}
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
                  {formatPrValue(
                    pr.kind,
                    pr.value,
                    resolveExerciseUnits(pr.units, appUnits).weightUnit,
                  )}
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

/** Label above figure, on a hairline-ruled band: the same grid as `StatBand`. */
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
  // Two columns rather than four across. A four-up row leaves each figure a
  // quarter of the width, which `adjustsFontSizeToFit` then resolves per tile,
  // and four numbers at four different sizes is not a table. The rules meet in
  // the middle and read as one.
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
