import { Ionicons } from '@expo/vector-icons';
import { formatDuration, formatVolume, type SetType } from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, EmptyState, Screen, Text } from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { ExerciseBlock } from '@/features/workouts/exercise-block';
import {
  buildCelebration,
  ExerciseCelebration,
  type CelebrationData,
} from '@/features/workouts/exercise-celebration';
import {
  cancelRestNotification,
  prepareRestNotifications,
  scheduleRestNotification,
} from '@/features/notifications/rest';
import { RestTimerBar } from '@/features/workouts/rest-timer-bar';
import {
  addExerciseToWorkout,
  addSet,
  deleteSet,
  discardWorkout,
  finishWorkout,
  getPreviousPerformance,
  removeExerciseFromWorkout,
  updateSet,
  type WorkoutExerciseDetail,
} from '@/features/workouts/repository';
import { useTicker } from '@/hooks/use-ticker';
import { useExercisePicker } from '@/store/exercise-picker';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing, useColors } from '@/theme';

export default function ActiveWorkoutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pendingExerciseIds = useExercisePicker((state) => state.pending);
  const clearPendingExercises = useExercisePicker((state) => state.clear);

  const settings = useSettings();
  const startRest = useTimer((state) => state.startRest);

  // Keeps the screen on mid-set so the phone doesn't lock between reps.
  useKeepAwake(settings.keepAwakeDuringWorkout ? 'active-workout' : undefined);

  const { data: activeRows = [] } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt))),
  );

  const workout = activeRows[0];
  const workoutId = workout?.id ?? '';

  const { data: links = [] } = useLiveQuery(
    db
      .select()
      .from(workoutExercises)
      .where(
        and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)),
      )
      .orderBy(asc(workoutExercises.position)),
    [workoutId],
  );

  const linkIds = links.map((link) => link.id);
  const linkKey = linkIds.join(',');

  const { data: sets = [] } = useLiveQuery(
    db
      .select()
      .from(workoutSets)
      // An empty IN () is invalid SQL, so fall back to a sentinel that matches nothing.
      .where(
        and(
          inArray(workoutSets.workoutExerciseId, linkIds.length > 0 ? linkIds : ['__none__']),
          isNull(workoutSets.deletedAt),
        ),
      )
      .orderBy(asc(workoutSets.position)),
    [linkKey],
  );

  /*
   * Only the exercises this workout uses.
   *
   * This was an unfiltered `select().from(exercisesTable)` — all ~6,800 catalog
   * rows marshalled out of SQLite to look up the six the session contains, and
   * `details` below rebuilt a 6,800-entry Map from them on every set edit
   * (measured at 0.87ms on desktop V8, several times that on device). The
   * screen needs a handful of rows; now it asks for a handful.
   */
  const exerciseIds = links.map((link) => link.exerciseId);
  const exerciseIdsKey = exerciseIds.join(',');

  const { data: workoutExerciseRows = [] } = useLiveQuery(
    db
      .select()
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds.length > 0 ? exerciseIds : ['__none__'])),
    [exerciseIdsKey],
  );

  const details = useMemo<WorkoutExerciseDetail[]>(() => {
    const exerciseById = new Map(workoutExerciseRows.map((row) => [row.id, row]));
    const setsByParent = new Map<string, WorkoutSet[]>();

    for (const set of sets) {
      const bucket = setsByParent.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsByParent.set(set.workoutExerciseId, [set]);
    }

    return links.flatMap((link) => {
      const exercise = exerciseById.get(link.exerciseId);
      if (!exercise) return [];
      return [{ workoutExercise: link, exercise, sets: setsByParent.get(link.id) ?? [] }];
    });
  }, [links, sets, workoutExerciseRows]);

  // Previous-session values for the ghost column, loaded once per exercise.
  const [previousByExercise, setPreviousByExercise] = useState<Record<string, WorkoutSet[]>>({});

  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  // Monotonic, so finishing the same exercise twice still replays the confetti.
  const celebrationSeq = useRef(0);
  const exerciseIdKey = details.map((detail) => detail.exercise.id).join(',');

  useEffect(() => {
    if (!workoutId) return;
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        exerciseIdKey
          .split(',')
          .filter(Boolean)
          .map(async (id) => [id, await getPreviousPerformance(id, workoutId)] as const),
      );
      if (!cancelled) setPreviousByExercise(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseIdKey, workoutId]);

  // Exercises chosen in the picker arrive through the hand-off store.
  useEffect(() => {
    if (pendingExerciseIds.length === 0 || !workoutId) return;

    void (async () => {
      for (const id of pendingExerciseIds) {
        const created = await addExerciseToWorkout(workoutId, id);
        await addSet(created.id);
      }
      clearPendingExercises();
    })();
  }, [pendingExerciseIds, workoutId, clearPendingExercises]);

  // Ask once when the logging screen first opens, rather than at app launch —
  // the permission prompt makes far more sense in context.
  useEffect(() => {
    if (settings.restTimerEnabled && settings.restTimerNotifications) {
      void prepareRestNotifications();
    }
  }, [settings.restTimerEnabled, settings.restTimerNotifications]);

  const liveStats = useMemo(() => {
    let volume = 0;
    let completed = 0;
    for (const detail of details) {
      for (const set of detail.sets) {
        if (!set.isCompleted) continue;
        completed += 1;
        volume += (set.weightKg ?? 0) * (set.reps ?? 0);
      }
    }
    return { volume, completed };
  }, [details]);

  const handleToggleSet = useCallback(
    async (set: WorkoutSet, detail: WorkoutExerciseDetail) => {
      const nextCompleted = !set.isCompleted;
      await updateSet(set.id, { isCompleted: nextCompleted });

      if (!nextCompleted) return;

      if (settings.hapticsEnabled) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // The live query has not refreshed yet, so "is the exercise finished?" is
      // answered from the rows already in hand plus the write just made — every
      // other set complete means this check was the last one.
      const finishesExercise =
        detail.sets.length > 0 &&
        detail.sets.every((other) => other.id === set.id || other.isCompleted);

      if (finishesExercise) {
        const finalSets = detail.sets.map((other) =>
          other.id === set.id ? { ...other, isCompleted: true } : other,
        );

        celebrationSeq.current += 1;
        const next = buildCelebration({
          id: celebrationSeq.current,
          exerciseName: detail.exercise.name,
          sets: finalSets,
          previousSets: previousByExercise[detail.exercise.id] ?? [],
          ctx: {
            trackingType: detail.exercise.trackingType,
            bodyweightKg: settings.bodyweightKg ?? undefined,
            formula: settings.oneRepMaxFormula,
          },
          weightUnit: settings.weightUnit,
          distanceUnit: settings.distanceUnit,
        });

        if (next) {
          setCelebration(next);
          // A second, heavier tap on top of the per-set success buzz: the same
          // gesture just closed out something bigger than a set.
          if (settings.hapticsEnabled) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          }
        }
      }

      if (settings.restTimerEnabled && settings.restTimerAutoStart) {
        const seconds =
          detail.workoutExercise.restSeconds ??
          detail.exercise.defaultRestSeconds ??
          settings.defaultRestSeconds;

        startRest(seconds, set.id);

        // The in-app countdown only runs while foregrounded, so back it with a
        // scheduled notification for when the phone goes in a pocket.
        if (settings.restTimerNotifications) {
          void scheduleRestNotification(seconds, detail.exercise.name);
        }
      }
    },
    [settings, startRest, previousByExercise],
  );

  // Stable, so the celebration's auto-dismiss timer isn't reset by a re-render
  // of this screen — every set edit causes one.
  const dismissCelebration = useCallback(() => setCelebration(null), []);

  const handleFinish = useCallback(() => {
    if (!workout) return;

    const anyCompleted = details.some((detail) => detail.sets.some((set) => set.isCompleted));
    if (!anyCompleted) {
      Alert.alert('Nothing logged', 'Complete at least one set before finishing.');
      return;
    }

    Alert.alert('Finish workout', 'Unchecked sets will be discarded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        style: 'default',
        onPress: () => {
          void (async () => {
            const result = await finishWorkout(workout.id, {
              bodyweightKg: settings.bodyweightKg ?? undefined,
              formula: settings.oneRepMaxFormula,
            });
            useTimer.getState().stopRest();
            void cancelRestNotification();
            router.replace({
              pathname: '/workout/summary/[id]',
              params: { id: result.workout.id },
            });
          })();
        },
      },
    ]);
  }, [workout, details, settings]);

  const handleDiscard = useCallback(() => {
    if (!workout) return;

    Alert.alert('Discard workout', 'This session will be deleted permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await discardWorkout(workout.id);
            useTimer.getState().stopRest();
            void cancelRestNotification();
            router.replace('/(tabs)/workout');
          })();
        },
      },
    ]);
  }, [workout]);

  if (!workout) {
    return (
      <Screen edges={['top']}>
        <EmptyState
          icon="barbell-outline"
          title="No active workout"
          description="Start a session from the Workout tab."
          action={<Button title="Go to Workout" onPress={() => router.replace('/(tabs)/workout')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: () => (
            <Pressable onPress={handleFinish} hitSlop={8}>
              <Text variant="bodyMedium" color="success">
                Finish
              </Text>
            </Pressable>
          ),
        }}
      />

      <View style={[styles.statsBar, { borderBottomColor: colors.border }]}>
        <ElapsedStat startedAt={workout.startedAt} />
        <Stat label="Volume" value={formatVolume(liveStats.volume, settings.weightUnit)} />
        <Stat label="Sets" value={String(liveStats.completed)} />
      </View>

      <RestTimerBar />

      <ScrollView
        // The discard button is the last thing in the scroll, so the system
        // navigation inset is added to the content rather than the container.
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing.huge + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {details.length === 0 ? (
          <EmptyState
            icon="add-circle-outline"
            title="No exercises yet"
            description="Add your first exercise to start logging sets."
          />
        ) : (
          details.map((detail, index) => (
            <View key={detail.workoutExercise.id}>
              {index > 0 && <Divider />}
              <ExerciseBlock
                detail={detail}
                previousSets={previousByExercise[detail.exercise.id] ?? []}
                onAddSet={() => {
                  // Carry the last set's load forward — the usual case is
                  // repeating the same weight for another set.
                  const last = detail.sets[detail.sets.length - 1];
                  void addSet(detail.workoutExercise.id, {
                    weightKg: last?.weightKg ?? null,
                    reps: last?.reps ?? null,
                    setType: 'normal',
                  });
                }}
                onUpdateSet={(setId, patch) => void updateSet(setId, patch)}
                onToggleSet={(set) => void handleToggleSet(set, detail)}
                onDeleteSet={(setId) => void deleteSet(setId)}
                onChangeSetType={(setId, setType: SetType) => void updateSet(setId, { setType })}
                onRemoveExercise={() => void removeExerciseFromWorkout(detail.workoutExercise.id)}
                onEditNotes={() => {
                  router.push({
                    pathname: '/workout/notes/[id]',
                    params: { id: detail.workoutExercise.id },
                  });
                }}
              />
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
          <Button title="Discard Workout" variant="ghost" fullWidth onPress={handleDiscard} />
        </View>
      </ScrollView>

      <ExerciseCelebration data={celebration} onDismiss={dismissCelebration} />
    </Screen>
  );
}

/**
 * The running duration, and the only thing on this screen that ticks.
 *
 * `useTicker` used to sit at the screen root, so once a second the whole tree
 * re-rendered: every exercise block, every set row, every text field in them.
 * A set row is a controlled input — competing with a full re-render every
 * second is what made typing a weight feel like it was fighting back. Owning
 * the ticker here confines the 1Hz update to this one `Text`.
 */
function ElapsedStat({ startedAt }: { startedAt: Date }) {
  const now = useTicker(1000);
  const elapsed = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));

  return <Stat label="Duration" value={formatDuration(elapsed)} highlight />;
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" color="textTertiary">
        {label}
      </Text>
      <Text variant="numeric" color={highlight ? 'accent' : 'text'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  stat: { gap: 2 },
  scroll: { paddingBottom: spacing.huge },
  actions: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
