import { BODY_PART_LABELS, formatDurationShort, formatVolume } from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import {
  Button,
  Card,
  HeaderAction,
  PromptModal,
  Screen,
  SectionHeader,
  splitMeasure,
  StatBand,
  Text,
} from '@/components/ui';
import { db } from '@/db/client';
import { touch, trackUpsertCoalesced } from '@/db/mutations';
import { personalRecords, workouts } from '@/db/schema';
import { workoutMuscleSplit } from '@/features/analytics/muscle-stats';
import { ExerciseSetList } from '@/features/workouts/exercise-set-list';
import {
  deleteWorkout,
  getWorkoutDetail,
  repeatWorkout,
  type WorkoutDetail,
} from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const weightUnit = useSettings((state) => state.weightUnit);
  const distanceUnit = useSettings((state) => state.distanceUnit);

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [prSetIds, setPrSetIds] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    const loaded = await getWorkoutDetail(id);
    setDetail(loaded ?? null);

    const records = await db
      .select({ setId: personalRecords.setId })
      .from(personalRecords)
      .where(and(eq(personalRecords.workoutId, id), isNull(personalRecords.deletedAt)));

    setPrSetIds(new Set(records.map((row) => row.setId).filter((value): value is string => !!value)));
  }, [id]);

  // Read on focus rather than in a mount effect. Nothing on this screen is a
  // live query, so a mount-only read would go on showing whatever storage held
  // when it was first opened; running it on focus also keeps the setState off
  // the render path, where it forces a second pass before the first frame.
  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

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

  const openActive = () => router.push('/workout/active');

  const repeat = async () => {
    // The latch is the ref, not the state that drives the spinner: two taps
    // inside one frame would both read the pre-render state and get through.
    if (inFlight.current) return;
    inFlight.current = true;
    setRepeating(true);

    try {
      // No `resumes` predicate: repeating always means a new session, so an
      // open one is never the thing being asked for, even when it came from the
      // same routine.
      const outcome = await startSession({
        create: () => repeatWorkout(id),
        openExisting: openActive,
      });

      if (outcome === 'started') openActive();
    } finally {
      inFlight.current = false;
      setRepeating(false);
    }
  };

  const confirmDelete = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Delete workout',
        message: 'This session, its sets and any records it set will be removed.',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      try {
        // The repository owns the order — records, then sets, then the session.
        // Deleting the row here left a mistyped record behind to gate every
        // future PR for that exercise.
        await deleteWorkout(id);
        router.back();
      } catch (error) {
        void showAlert(
          'Could not delete the workout',
          error instanceof Error ? error.message : 'The session is still here.',
        );
      }
    })();
  };

  // Above the loading guard, because hooks cannot be conditional.
  const split = useMemo<BarDatum[]>(() => {
    if (!detail) return [];

    return workoutMuscleSplit(detail.exercises).map((slice) => ({
      label: BODY_PART_LABELS[slice.bodyPart],
      value: slice.share * 100,
    }));
  }, [detail]);

  if (!detail) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Workout' }} />
      </Screen>
    );
  }

  const { workout, exercises } = detail;

  const startedAt = workout.startedAt.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const [volume, volumeUnit] = splitMeasure(formatVolume(workout.totalVolumeKg, weightUnit));

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: () => (
            <HeaderAction
              label="Delete workout"
              icon="trash-outline"
              tone="danger"
              onPress={confirmDelete}
            />
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* `title`, the same size the summary screen sets this same object at.
            The date has to stay inside the label: supplying one on the
            Pressable replaces the merged child text, so naming only the workout
            would tell a screen reader less than the silent version did. */}
        <Pressable
          onPress={() => setRenaming(true)}
          style={styles.titleBlock}
          accessibilityRole="button"
          accessibilityLabel={`${workout.name}, ${startedAt}`}
          accessibilityHint="Renames this workout"
        >
          <Text variant="title">{workout.name}</Text>
          <Text variant="label" color="textSecondary">
            {startedAt}
          </Text>
        </Pressable>

        {/* One stat grammar across the app: overline labels over tabular
            figures — not 15px numbers in a rounded box, which is what made this
            session's four figures read differently here than on the summary
            screen one tap away. Four across a phone is one too many for a
            single band once a six-digit volume is one of them, so they run as
            two of two, paired by kind, and read as a 2×2 grid. */}
        <View style={styles.band}>
          <StatBand
            items={[
              { label: 'Duration', value: formatDurationShort(workout.durationSeconds ?? 0) },
              { label: 'Volume', value: volume, unit: volumeUnit },
            ]}
          />
          <StatBand
            items={[
              { label: 'Sets', value: String(workout.totalSets) },
              { label: 'Records', value: String(workout.prCount) },
            ]}
          />
        </View>

        {workout.notes ? (
          <Card style={styles.notes}>
            <Text variant="label" color="textSecondary">
              {workout.notes}
            </Text>
          </Card>
        ) : null}

        {/* Percentages of the session's completed working sets, primary muscle
            only — see `workoutMuscleSplit` for why the secondary discount the
            statistics screens apply is deliberately not used here. */}
        {split.length > 0 && (
          <>
            <SectionHeader title="Muscle split" />
            <View style={styles.chart}>
              <BarChart data={split} formatValue={(value) => `${Math.round(value)}%`} />
            </View>
          </>
        )}

        <SectionHeader title="Workout" />

        {exercises.map((entry) => (
          <ExerciseSetList
            key={entry.workoutExercise.id}
            exerciseId={entry.exercise.id}
            name={entry.exercise.name}
            thumbnailUrl={entry.exercise.thumbnailUrl}
            notes={entry.workoutExercise.notes}
            sets={entry.sets}
            recordSetIds={prSetIds}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
          />
        ))}

        <View style={styles.repeat}>
          <Button
            title="Repeat workout"
            variant="secondary"
            fullWidth
            loading={repeating}
            onPress={() => void repeat()}
          />
          {/* Said plainly here so the empty fields are not a surprise: the copy
              carries the structure, and the numbers are already one column away
              in Previous. */}
          <Text variant="caption" color="textTertiary">
            Copies the exercises and set structure, not the weights and reps.
          </Text>
        </View>
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

const styles = StyleSheet.create({
  // No horizontal padding: the set rows stripe edge to edge, so every other
  // block carries the screen margin itself. See `ExerciseSetList`.
  content: { paddingBottom: spacing.huge },
  titleBlock: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  band: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  notes: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  chart: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  repeat: { margin: spacing.lg, marginTop: spacing.xxl, gap: spacing.sm },
});
