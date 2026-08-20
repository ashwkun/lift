import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  formatWeight,
  isWorkingSet,
  SET_TYPE_BADGE,
} from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  HeaderAction,
  PromptModal,
  Screen,
  splitMeasure,
  StatBand,
  Text,
} from '@/components/ui';
import { db } from '@/db/client';
import { touch, trackUpsertCoalesced } from '@/db/mutations';
import { personalRecords, workouts } from '@/db/schema';
import {
  deleteWorkout,
  getWorkoutDetail,
  repeatWorkout,
  type WorkoutDetail,
} from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/**
 * The name sits in a `Card` with `gap: spacing.sm`, so the target is grown with
 * slop rather than padding: padding would push the name away from the divider
 * on every exercise card, while slop moves nothing.
 */
const EXERCISE_TITLE_SLOP = { top: 12, bottom: 12 };

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

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
    Alert.alert(
      'Delete workout',
      'This session, its sets and any records it set will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                // The repository owns the order — records, then sets, then the
                // session. Deleting the row here left a mistyped record behind
                // to gate every future PR for that exercise.
                await deleteWorkout(id);
                router.back();
              } catch (error) {
                Alert.alert(
                  'Could not delete the workout',
                  error instanceof Error ? error.message : 'The session is still here.',
                );
              }
            })();
          },
        },
      ],
    );
  };

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

        {/* One stat grammar across the app: hairline rules, overline labels,
            tabular figures — not 15px numbers in a rounded box, which is what
            made this session's four figures read differently here than on the
            summary screen one tap away. Four across a phone is one too many for
            a single band, so they run as two of two, paired by kind. */}
        <View>
          <StatBand
            items={[
              { label: 'Duration', value: formatDurationShort(workout.durationSeconds ?? 0) },
              { label: 'Volume', value: volume, unit: volumeUnit },
            ]}
          />
          <StatBand
            style={styles.totalsLower}
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

        {exercises.map((entry) => {
          let workingIndex = 0;

          return (
            <Card key={entry.workoutExercise.id} style={styles.exerciseCard}>
              {/* Announced the same way as the block on the active screen, and
                  set the same way: subheading, no accent. The accent is
                  budgeted at roughly one element per view (`theme/tokens.ts`)
                  and this list was spending it once per exercise. The chevron
                  is what says the name is a link now that the colour doesn't. */}
              <Pressable
                style={styles.exerciseTitleRow}
                hitSlop={EXERCISE_TITLE_SLOP}
                onPress={() =>
                  router.push({ pathname: '/exercise/[id]', params: { id: entry.exercise.id } })
                }
                accessibilityRole="link"
                accessibilityLabel={`${entry.exercise.name}, view history and records`}
              >
                <Text variant="subheading" color="text" numberOfLines={1} style={styles.flex}>
                  {entry.exercise.name}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
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
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  titleBlock: { gap: spacing.xs },
  // The bands stack, so the second drops its top rule rather than doubling the
  // first one's bottom.
  totalsLower: { borderTopWidth: 0 },
  notes: {},
  exerciseCard: { gap: spacing.sm },
  exerciseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  setIndex: { width: 20 },
  setValue: { flex: 1 },
  repeat: { marginTop: spacing.lg, gap: spacing.sm },
});
