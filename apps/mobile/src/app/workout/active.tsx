import { Ionicons } from '@expo/vector-icons';
import { formatDuration, formatVolume, type SetType } from '@ironlog/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing, useColors } from '@/theme';

export default function ActiveWorkoutScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ addedExerciseIds?: string }>();

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

  const { data: allExercises = [] } = useLiveQuery(db.select().from(exercisesTable));

  const details = useMemo<WorkoutExerciseDetail[]>(() => {
    const exerciseById = new Map(allExercises.map((row) => [row.id, row]));
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
  }, [links, sets, allExercises]);

  // Previous-session values for the ghost column, loaded once per exercise.
  const [previousByExercise, setPreviousByExercise] = useState<Record<string, WorkoutSet[]>>({});
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

  // Exercises chosen in the picker come back as a route param.
  useEffect(() => {
    const ids = params.addedExerciseIds;
    if (!ids || !workoutId) return;

    void (async () => {
      for (const id of ids.split(',').filter(Boolean)) {
        const created = await addExerciseToWorkout(workoutId, id);
        await addSet(created.id);
      }
      router.setParams({ addedExerciseIds: undefined });
    })();
  }, [params.addedExerciseIds, workoutId]);

  const now = useTicker(1000, Boolean(workout));
  const elapsed = workout ? Math.floor((now - workout.startedAt.getTime()) / 1000) : 0;

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

      if (settings.restTimerEnabled && settings.restTimerAutoStart) {
        const seconds =
          detail.workoutExercise.restSeconds ??
          detail.exercise.defaultRestSeconds ??
          settings.defaultRestSeconds;
        startRest(seconds, set.id);
      }
    },
    [settings, startRest],
  );

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
        <Stat label="Duration" value={formatDuration(elapsed)} highlight />
        <Stat label="Volume" value={formatVolume(liveStats.volume, settings.weightUnit)} />
        <Stat label="Sets" value={String(liveStats.completed)} />
      </View>

      <RestTimerBar />

      <ScrollView
        contentContainerStyle={styles.scroll}
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
    </Screen>
  );
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
