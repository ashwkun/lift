import { Ionicons } from '@expo/vector-icons';
import {
  fromDisplayWeight,
  reorder,
  toDisplayWeight,
  type PositionedRow,
} from '@lift/shared';
import { and, desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Divider,
  EmptyState,
  HeaderAction,
  NumericField,
  PromptModal,
  ReorderSheet,
  Screen,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import {
  addExerciseToRoutine,
  addRoutineSet,
  applyRoutineExerciseOrder,
  deleteRoutine,
  deleteRoutineSet,
  getRoutineDetail,
  removeExerciseFromRoutine,
  updateRoutine,
  updateRoutineSet,
  type RoutineDetail,
  type RoutineExerciseDetail,
} from '@/features/routines/repository';
import { resolveExerciseUnits, useAppUnits } from '@/features/exercises/units';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { haptics } from '@/features/feedback/haptics';
import { showConfirm } from '@/store/dialog';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { MIN_TOUCH_SIZE, radius, spacing, useColors } from '@/theme';

/**
 * Matches the identical control in `exercise-block.tsx`: 34pt of row plus 8pt
 * above and below is 50pt of target. No horizontal slop. The row is full
 * width, so there is nothing either side of it to reach into or steal from.
 */
const ADD_SET_SLOP = { top: 8, bottom: 8 };

export default function RoutineEditorScreen() {
  const scrollEdge = useScrollEdge();

  const { id } = useLocalSearchParams<{ id: string }>();

  // Addressed per routine, not per screen: this editor has one instance per
  // routine id, and returning to a *different* routine must not collect a
  // delivery meant for the one that was left.
  const pickerAddress = `routine:${id}`;
  const pendingExerciseIds = usePickedExercises(pickerAddress);
  const clearPendingExercises = useExercisePicker((state) => state.clear);
  const openPicker = useExercisePicker((state) => state.open);

  const colors = useColors();
  const appUnits = useAppUnits();

  /*
   * The unit one prescribed row is written in.
   *
   * Per exercise rather than per routine: a target typed here and the number
   * typed against it in a session have to be the same number, and reading in
   * kilos what will be entered in pounds is how a routine ends up prescribing a
   * 100 kg dumbbell press. A function rather than a value computed in the map,
   * because it is wanted at three points inside one JSX block and lifting the
   * block into a body to hold a `const` would re-indent a hundred lines to say
   * the same thing.
   */
  const weightUnitFor = (entry: RoutineExerciseDetail) =>
    resolveExerciseUnits(entry.exercise, appUnits).weightUnit;

  const [detail, setDetail] = useState<RoutineDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  // Whether the session that is already running came from this routine, so the
  // action can say what the tap will really do.
  const { data: openRows = [] } = useLiveQuery(
    db
      .select({ routineId: workouts.routineId })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
    [id],
  );

  const resuming = openRows[0]?.routineId === id;

  const reload = useCallback(async () => {
    setDetail((await getRoutineDetail(id)) ?? null);
  }, [id]);

  const [reordering, setReordering] = useState(false);

  // Names and set counts. A routine's blocks are told apart by what they are
  // and how much of them there is. The target weights are the screen behind
  // the sheet, not the thing being ordered.
  const reorderItems = useMemo<ReorderItem[]>(
    () =>
      (detail?.exercises ?? []).map((entry) => ({
        id: entry.routineExercise.id,
        label: entry.exercise.name,
        detail: `${entry.sets.length} ${entry.sets.length === 1 ? 'set' : 'sets'}`,
      })),
    [detail],
  );

  /**
   * Writes the order the sheet came back with, then re-reads.
   *
   * Replayed as single moves rather than written as a block, which is what
   * keeps the usual drag to one row: `reorder()` takes a midpoint where it can
   * and only renumbers when the gap between two neighbours is spent. The
   * working copy is advanced with each hop so the next one is computed against
   * the positions the last one produced.
   *
   * A reload rather than an optimistic reorder of `detail`: this screen has no
   * live query, so storage is the only thing that knows the new order, and the
   * write is fast enough that the list does not visibly wait for it.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setReordering(false);

      void (async () => {
        let rows: PositionedRow[] = (detail?.exercises ?? []).map((entry) => ({
          id: entry.routineExercise.id,
          position: entry.routineExercise.position,
        }));

        const writes = new Map<string, PositionedRow>();

        orderedIds.forEach((rowId, target) => {
          const from = rows.findIndex((row) => row.id === rowId);
          if (from === -1 || from === target) return;

          const moved = reorder(rows, from, target);
          if (moved.length === 0) return;

          const byId = new Map(moved.map((row) => [row.id, row.position]));
          rows = rows
            .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
            .sort((a, b) => a.position - b.position);

          // Last write wins: a row nudged twice while replaying the hops only
          // needs the position it ended on.
          for (const row of moved) writes.set(row.id, row);
        });

        if (writes.size === 0) return;

        haptics.selection();
        await applyRoutineExerciseOrder([...writes.values()]);
        await reload();
      })();
    },
    [detail, reload],
  );

  // Read on focus rather than in a mount effect. Nothing on this screen is a
  // live query, so a mount-only read would go on showing whatever storage held
  // when the editor was first opened; running it on focus also keeps the
  // setState off the render path, where it forces a second pass before the
  // first frame.
  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Exercises picked in the modal arrive through the hand-off store.
  useEffect(() => {
    if (pendingExerciseIds.length === 0) return;

    void (async () => {
      for (const exerciseId of pendingExerciseIds) {
        await addExerciseToRoutine(id, exerciseId);
      }
      clearPendingExercises(pickerAddress);
      await reload();
    })();
  }, [pendingExerciseIds, id, reload, clearPendingExercises, pickerAddress]);

  // Replace rather than push: once the session is running, backing out of it
  // should land on the workout tab, not on the editor for the routine that is
  // already open on screen behind it.
  const goToActive = () => router.replace('/workout/active');

  const begin = async () => {
    // The latch is the ref, not the state that drives the spinner: two taps
    // inside one frame would both read the pre-render state and get through.
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);

    try {
      const outcome = await startSession({
        create: () => startWorkout({ routineId: id }),
        resumes: (open) => open.routineId === id,
        openExisting: goToActive,
      });

      if (outcome === 'started' || outcome === 'resumed') goToActive();
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  const confirmDelete = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Delete routine',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      await deleteRoutine(id);
      router.back();
    })();
  };

  if (!detail) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Routine' }} />
      </Screen>
    );
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: detail.routine.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              {/* Only once there is an order to change. A reorder control above
                  a one-exercise routine is a button that cannot do anything,
                  and this is the screen where a routine is built up from
                  nothing, so it would spend its first minutes dead. */}
              {detail.exercises.length > 1 && (
                <HeaderAction
                  label="Reorder exercises"
                  icon="swap-vertical-outline"
                  onPress={() => setReordering(true)}
                />
              )}
              <HeaderAction
                label="Delete routine"
                icon="trash-outline"
                tone="danger"
                onPress={confirmDelete}
              />
            </View>
          ),
        }}
      />

      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.nameField}>
          <Text variant="overline" color="textTertiary">
            Routine name
          </Text>
          {/* The name is the only way to rename a routine, and it said none of
              that: no role, no cue for a sighted user, and a ~24pt line box for
              a target. The pencil is the part a gym user notices; the frame is
              what a thumb finds. The label stays the visible text so Voice
              Control's "tap <routine name>" keeps working. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detail.routine.name}
            accessibilityHint="Renames this routine"
            onPress={() => setRenaming(true)}
            style={styles.nameButton}
          >
            <Text variant="subheading" numberOfLines={1} style={styles.nameText}>
              {detail.routine.name}
            </Text>
            <Ionicons name="pencil" size={14} color={colors.textTertiary} />
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
                {/* No accent, and a heavier variant to carry the row instead.
                    The accent is budgeted at roughly one element per view
                    (`theme/tokens.ts`) and this list was spending it once per
                    exercise; at body size the name then reads lighter than the
                    numbers stacked under it, which is what left the column
                    undifferentiated. No chevron either: unlike the workout
                    screens this name is not a link, and a chevron would promise
                    navigation that never happens. */}
                <Text variant="subheading" color="text" numberOfLines={1} style={styles.flex}>
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
                <Text variant="overline" color="textTertiary" style={styles.setCell}>
                  Set
                </Text>
                <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                  {weightUnitFor(entry)}
                </Text>
                <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                  Reps
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
                        : String(
                            Math.round(
                              toDisplayWeight(set.targetWeightKg, weightUnitFor(entry)) * 10,
                            ) / 10,
                          )
                    }
                    placeholder="—"
                    onChangeText={(text) => {
                      const parsed = text === '' ? null : Number(text.replace(',', '.'));
                      if (parsed !== null && !Number.isFinite(parsed)) return;
                      void updateRoutineSet(set.id, {
                        targetWeightKg:
                          parsed === null ? null : fromDisplayWeight(parsed, weightUnitFor(entry)),
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
                hitSlop={ADD_SET_SLOP}
                onPress={() => {
                  const last = entry.sets[entry.sets.length - 1];
                  void addRoutineSet(entry.routineExercise.id, {
                    targetReps: last?.targetReps ?? null,
                    targetWeightKg: last?.targetWeightKg ?? null,
                  }).then(reload);
                }}
                style={({ pressed }) => [
                  styles.addSet,
                  { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
                ]}
              >
                <Ionicons name="add" size={16} color={colors.textSecondary} />
                <Text variant="label" color="textSecondary">
                  Add set
                </Text>
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.actions}>
          <Button
            title="Add exercise"
            icon="add"
            fullWidth
            onPress={() => {
              // The routine's current exercises travel with the request, so the
              // picker suggests what usually trains alongside them.
              openPicker(
                pickerAddress,
                detail.exercises.map((entry) => entry.exercise.id),
              );
              router.push('/exercise/picker');
            }}
          />
          <Button
            // With this routine's own session already open, going through is a
            // resume; the old label promised a fresh session it never created.
            title={resuming ? 'Resume routine' : 'Start routine'}
            variant="success"
            fullWidth
            loading={starting}
            disabled={detail.exercises.length === 0}
            onPress={() => void begin()}
          />
        </View>
      </ScrollView>

      <PromptModal
        visible={renaming}
        title="Rename routine"
        initialValue={detail.routine.name}
        placeholder="Routine name"
        maxLength={60}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          setRenaming(false);
          void updateRoutine(id, { name: value }).then(reload);
        }}
      />

      <ReorderSheet
        visible={reordering}
        title="Reorder exercises"
        items={reorderItems}
        onClose={() => setReordering(false)}
        onCommit={handleReorder}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  content: { paddingBottom: spacing.huge },
  nameField: { padding: spacing.lg, gap: spacing.xs },
  nameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_SIZE,
  },
  // Shrinks rather than grows, so the pencil stays beside the name instead of
  // being pushed to the far margin where it stops reading as part of it.
  nameText: { flexShrink: 1 },
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
