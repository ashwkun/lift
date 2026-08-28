import { Ionicons } from '@expo/vector-icons';
import {
  formatDuration,
  fromDisplayDistance,
  fromDisplayWeight,
  normalizeSupersets,
  parseDuration,
  reorder,
  toDisplayDistance,
  toDisplayWeight,
  TRACKING_FIELDS,
  trimZeros,
  type DistanceUnit,
  type PositionedRow,
  type SupersetAssignment,
} from '@lift/shared';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Divider,
  EmptyState,
  HeaderAction,
  ListPicker,
  NumericField,
  PromptModal,
  ReorderSheet,
  Screen,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import { routineFolders, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import {
  addExerciseToRoutine,
  addRoutineSet,
  applyRoutineExerciseOrder,
  applyRoutineSupersetGroups,
  deleteRoutine,
  deleteRoutineSet,
  getRoutineDetail,
  removeExerciseFromRoutine,
  updateRoutine,
  updateRoutineExercise,
  updateRoutineSet,
  type RoutineDetail,
  type RoutineExerciseDetail,
} from '@/features/routines/repository';
import { resolveExerciseUnits, useAppUnits } from '@/features/exercises/units';
import { startWorkout } from '@/features/workouts/repository';
import {
  showSupersetMenu,
  SupersetChip,
  supersetMap,
  SupersetTie,
} from '@/features/workouts/superset';
import { startSession } from '@/features/workouts/start-session';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useLaunchAction } from '@/hooks/use-launch-action';
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

/**
 * How a stored distance and a stored time are spelled back into their fields.
 *
 * Both mirror the pair `set-row.tsx` keeps module-private, and they have to: a
 * target typed here and the number typed against it in the gym are the same
 * number, so a routine that rendered 2000 m differently from the logging screen
 * would be prescribing something the logger cannot agree it did.
 *
 * Two decimals and trimmed zeros absorb the float noise a unit round trip
 * leaves behind, since a mile-entered 3 comes back 2.999999999999 and an
 * untrimmed "3.00" reappears as characters to delete before typing.
 * `normalizeDuration` exists because seconds are always re-spelled as M:SS, so
 * a typed "4" returns as "0:04" and a field without it would match none of its
 * own echoes and go inert.
 */
const asDistanceField = (km: number, unit: DistanceUnit) =>
  trimZeros(toDisplayDistance(km, unit).toFixed(2));

const normalizeDuration = (text: string) => {
  const seconds = parseDuration(text);
  return seconds == null ? '' : formatDuration(seconds);
};

export default function RoutineEditorScreen() {
  const scrollEdge = useScrollEdge();

  const { id, start } = useLocalSearchParams<{ id: string; start?: string }>();

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
   * The units one prescribed row is written in.
   *
   * Per exercise rather than per routine: a target typed here and the number
   * typed against it in a session have to be the same number, and reading in
   * kilos what will be entered in pounds is how a routine ends up prescribing a
   * 100 kg dumbbell press. A function rather than a value computed in the map,
   * because it is wanted at several points inside one JSX block and lifting the
   * block into a body to hold a `const` would re-indent a hundred lines to say
   * the same thing.
   */
  const unitsFor = (entry: RoutineExerciseDetail) => resolveExerciseUnits(entry.exercise, appUnits);

  /**
   * Which numeric columns this exercise prescribes in.
   *
   * The same switch the logging screen performs, for the same reason and off the
   * same table: a plank has no weight to prescribe and a row has no reps. A
   * function rather than a `const`, for the reason above it.
   */
  const fieldsFor = (entry: RoutineExerciseDetail) => TRACKING_FIELDS[entry.exercise.trackingType];

  const [detail, setDetail] = useState<RoutineDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [editingRoutineNotes, setEditingRoutineNotes] = useState(false);
  const [editingExerciseNotesFor, setEditingExerciseNotesFor] = useState<string | null>(null);
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

  const { rows: folders = [] } = useRows(
    db
      .select()
      .from(routineFolders)
      .where(isNull(routineFolders.deletedAt))
      .orderBy(asc(routineFolders.position))
  );

  const resuming = openRows[0]?.routineId === id;

  const reload = useCallback(async () => {
    setDetail((await getRoutineDetail(id)) ?? null);
  }, [id]);

  /*
   * The rows the superset logic reads: grouping and order, nothing else.
   *
   * Keyed by `routineExercise.id` rather than by the exercise's, because a
   * routine may prescribe the same lift twice and only one of the two may be in
   * the superset.
   */
  const supersetRows = useMemo(
    () =>
      (detail?.exercises ?? []).map((entry) => ({
        id: entry.routineExercise.id,
        name: entry.exercise.name,
        supersetGroup: entry.routineExercise.supersetGroup,
      })),
    [detail],
  );

  const placements = useMemo(() => supersetMap(supersetRows), [supersetRows]);

  // A reload rather than an optimistic edit, for the same reason `handleReorder`
  // reloads: nothing on this screen is a live query, so storage is the only
  // thing that knows what the grouping is now.
  const applySupersets = useCallback(
    (writes: SupersetAssignment[]) => {
      if (writes.length === 0) return;
      void applyRoutineSupersetGroups(writes).then(reload);
    },
    [reload],
  );

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

        /*
         * A drag is a superset control whether or not it meant to be: dropping
         * an exercise between two halves of a pair leaves two lifts carrying a
         * group id with something standing between them, which is no longer a
         * superset. `rows` is already in the order the sheet produced, so the
         * grouping is read back off it and whatever no longer holds is cleared.
         *
         * Usually this writes nothing and returns without a statement.
         */
        const groups = new Map(
          (detail?.exercises ?? []).map((entry) => [
            entry.routineExercise.id,
            entry.routineExercise.supersetGroup,
          ]),
        );

        await applyRoutineSupersetGroups(
          normalizeSupersets(
            rows.map((row) => ({ id: row.id, supersetGroup: groups.get(row.id) ?? null })),
          ),
        );

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

  /*
   * `?start=<token>` starts the session on arrival.
   *
   * How the routines widget on the home screen begins a workout: the row's link
   * lands here and this runs the same `begin` the Start button runs. It is
   * deliberately not a separate path — the one-session rule, the resume case and
   * the "a workout is in progress" dialog are all decisions `startSession` makes
   * once, and a widget that re-made any of them would be a second opinion about
   * the most destructive question this app asks.
   *
   * The token, and why a flag would not do, are in `use-launch-action.ts`.
   */
  useLaunchAction(start, () => {
    void begin();
  });

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
          <View style={styles.notesHeader}>
            <Text variant="overline" color="textTertiary">
              Routine name
            </Text>
            {folders.length > 0 && (
              <ListPicker
                label="Folder"
                value={detail.routine.folderId ?? 'none'}
                options={[
                  { value: 'none', label: 'No folder' },
                  ...folders.map((f) => ({ value: f.id, label: f.name })),
                ]}
                onChange={(value) => {
                  void updateRoutine(id, { folderId: value === 'none' ? null : value }).then(reload);
                }}
              />
            )}
          </View>
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

        <View style={styles.nameField}>
          <View style={styles.notesHeader}>
            <Text variant="overline" color="textTertiary">
              Notes
            </Text>
            {(detail.routine.notes || detail.routine.isNotesPinned) ? (
              <Pressable
                onPress={() => {
                  haptics.selection();
                  void updateRoutine(id, { isNotesPinned: !detail.routine.isNotesPinned }).then(reload);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={detail.routine.isNotesPinned ? "Unpin notes" : "Pin notes"}
              >
                <Ionicons
                  name={detail.routine.isNotesPinned ? "pin" : "pin-outline"}
                  size={16}
                  color={detail.routine.isNotesPinned ? colors.accent : colors.textTertiary}
                />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detail.routine.notes || "Add note"}
            accessibilityHint="Edits routine notes"
            onPress={() => setEditingRoutineNotes(true)}
            style={styles.nameButton}
          >
            <Text variant="bodyMedium" numberOfLines={1} color={detail.routine.notes ? 'textSecondary' : 'textTertiary'} style={styles.nameText}>
              {detail.routine.notes || "Add a note..."}
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
              {/* A member that is not the first of its run is tied to the block
                  above rather than separated from it: a run is contiguous, so
                  "not first" is the whole test. See `SupersetTie`. */}
              {index > 0 &&
                (placements.get(entry.routineExercise.id)?.first === false ? (
                  <SupersetTie />
                ) : (
                  <Divider />
                ))}

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
                {/* Nothing to pair with in a routine of one, so no control: the
                    same rule the reorder action in the header follows. */}
                {detail.exercises.length > 1 && (
                  <SupersetChip
                    placement={placements.get(entry.routineExercise.id)}
                    exerciseName={entry.exercise.name}
                    onPress={() =>
                      showSupersetMenu(supersetRows, entry.routineExercise.id, applySupersets)
                    }
                  />
                )}
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

              <View style={styles.exerciseNotesField}>
                <View style={styles.notesHeader}>
                  <Text variant="overline" color="textTertiary">
                    Notes
                  </Text>
                  {(entry.routineExercise.notes || entry.routineExercise.isNotesPinned) ? (
                    <Pressable
                      onPress={() => {
                        haptics.selection();
                        void updateRoutineExercise(entry.routineExercise.id, { 
                          isNotesPinned: !entry.routineExercise.isNotesPinned 
                        }).then(reload);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={entry.routineExercise.isNotesPinned ? "Unpin notes" : "Pin notes"}
                    >
                      <Ionicons
                        name={entry.routineExercise.isNotesPinned ? "pin" : "pin-outline"}
                        size={16}
                        color={entry.routineExercise.isNotesPinned ? colors.accent : colors.textTertiary}
                      />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={entry.routineExercise.notes || "Add note"}
                  accessibilityHint="Edits exercise notes"
                  onPress={() => setEditingExerciseNotesFor(entry.routineExercise.id)}
                  style={styles.nameButton}
                >
                  <Text variant="bodyMedium" numberOfLines={1} color={entry.routineExercise.notes ? 'textSecondary' : 'textTertiary'} style={styles.nameText}>
                    {entry.routineExercise.notes || "Add a note..."}
                  </Text>
                  <Ionicons name="pencil" size={14} color={colors.textTertiary} />
                </Pressable>
              </View>

              {/* The columns an exercise is prescribed in are the exercise's
                  own, not the editor's. This used to be a fixed weight-and-reps
                  pair whatever the movement, so a plank was prescribed a rep
                  count it has no use for, had nowhere to say "60 seconds", and
                  then started its session as a blank weight-and-reps row. */}
              <View style={styles.columnHeader}>
                <Text variant="overline" color="textTertiary" style={styles.setCell}>
                  Set
                </Text>
                {fieldsFor(entry).weight && (
                  <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                    {unitsFor(entry).weightUnit}
                  </Text>
                )}
                {fieldsFor(entry).duration && (
                  <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                    Time
                  </Text>
                )}
                {fieldsFor(entry).distance && (
                  <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                    {unitsFor(entry).distanceUnit}
                  </Text>
                )}
                {fieldsFor(entry).reps && (
                  <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                    Reps
                  </Text>
                )}
                {/* Outside the switch, because effort is prescribable for every
                    movement: "ten at RPE 8" and "hold it until there are two
                    left in the tank" are the same instruction, and no tracking
                    type excludes having one. Never more than three columns
                    beside it either, since no tracking type asks for weight,
                    reps and distance at once. */}
                <Text variant="overline" color="textTertiary" style={styles.targetCell}>
                  RPE
                </Text>
                <View style={styles.removeSpacer} />
              </View>

              {entry.sets.map((set, setIndex) => (
                <View key={set.id} style={styles.setRow}>
                  <Text variant="numeric" color="textSecondary" style={styles.setCell}>
                    {setIndex + 1}
                  </Text>
                  {fieldsFor(entry).weight && (
                    <NumericField
                      value={
                        set.targetWeightKg == null
                          ? ''
                          : String(
                              Math.round(
                                toDisplayWeight(set.targetWeightKg, unitsFor(entry).weightUnit) * 10,
                              ) / 10,
                            )
                      }
                      placeholder="—"
                      accessibilityLabel={`Set ${setIndex + 1}, target weight in ${unitsFor(entry).weightUnit}`}
                      onChangeText={(text) => {
                        const parsed = text === '' ? null : Number(text.replace(',', '.'));
                        if (parsed !== null && !Number.isFinite(parsed)) return;
                        void updateRoutineSet(set.id, {
                          targetWeightKg:
                            parsed === null
                              ? null
                              : fromDisplayWeight(parsed, unitsFor(entry).weightUnit),
                        }).then(reload);
                      }}
                    />
                  )}
                  {fieldsFor(entry).duration && (
                    <NumericField
                      value={
                        set.targetDurationSeconds == null
                          ? ''
                          : formatDuration(set.targetDurationSeconds)
                      }
                      placeholder="—"
                      normalize={normalizeDuration}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel={`Set ${setIndex + 1}, target time`}
                      onChangeText={(text) => {
                        if (text === '') {
                          void updateRoutineSet(set.id, { targetDurationSeconds: null }).then(
                            reload,
                          );
                          return;
                        }
                        // A stray "." or a fourth colon is a keystroke on the
                        // way somewhere, not an instruction to forget the time
                        // already prescribed. The logging field reads it the
                        // same way, through the same parser.
                        const parsed = parseDuration(text);
                        if (parsed == null) return;
                        void updateRoutineSet(set.id, { targetDurationSeconds: parsed }).then(
                          reload,
                        );
                      }}
                    />
                  )}
                  {fieldsFor(entry).distance && (
                    <NumericField
                      value={
                        set.targetDistanceKm == null
                          ? ''
                          : asDistanceField(set.targetDistanceKm, unitsFor(entry).distanceUnit)
                      }
                      placeholder="—"
                      accessibilityLabel={`Set ${setIndex + 1}, target distance in ${unitsFor(entry).distanceUnit}`}
                      onChangeText={(text) => {
                        const parsed = text === '' ? null : Number(text.replace(',', '.'));
                        if (parsed !== null && !Number.isFinite(parsed)) return;
                        // Stored in kilometres whatever the column is headed,
                        // which is the rule everywhere: a miles user typing
                        // 2000 m worth of rowing has to get the same target
                        // back that a kilometres user typing 2 does.
                        void updateRoutineSet(set.id, {
                          targetDistanceKm:
                            parsed === null
                              ? null
                              : fromDisplayDistance(parsed, unitsFor(entry).distanceUnit),
                        }).then(reload);
                      }}
                    />
                  )}
                  {fieldsFor(entry).reps && (
                    <NumericField
                      value={set.targetReps == null ? '' : String(set.targetReps)}
                      placeholder="—"
                      keyboardType="number-pad"
                      accessibilityLabel={`Set ${setIndex + 1}, target reps`}
                      onChangeText={(text) => {
                        const parsed = text === '' ? null : Number.parseInt(text, 10);
                        if (parsed !== null && !Number.isFinite(parsed)) return;
                        void updateRoutineSet(set.id, { targetReps: parsed }).then(reload);
                      }}
                    />
                  )}
                  <NumericField
                    value={set.targetRpe == null ? '' : trimZeros(set.targetRpe.toFixed(1))}
                    placeholder="—"
                    accessibilityLabel={`Set ${setIndex + 1}, target RPE`}
                    onChangeText={(text) => {
                      const parsed = text === '' ? null : Number(text.replace(',', '.'));
                      if (parsed !== null && !Number.isFinite(parsed)) return;
                      // Off the scale is ignored rather than clamped, the way
                      // the time field ignores an unparseable string: an 88 on
                      // the way to 8.8 is a keystroke, and clamping it would
                      // store a 10 nobody typed and prescribe it in the gym.
                      if (parsed !== null && (parsed < 1 || parsed > 10)) return;
                      void updateRoutineSet(set.id, { targetRpe: parsed }).then(reload);
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

              <View style={styles.addSetRow}>
                <Pressable
                  hitSlop={ADD_SET_SLOP}
                  onPress={() => {
                    haptics.selection();
                    const last = entry.sets[entry.sets.length - 1];
                    void addRoutineSet(entry.routineExercise.id, {
                      setType: 'warmup',
                      targetReps: last?.targetReps ?? null,
                      targetWeightKg: last?.targetWeightKg ?? null,
                      targetDurationSeconds: last?.targetDurationSeconds ?? null,
                      targetDistanceKm: last?.targetDistanceKm ?? null,
                      targetRpe: last?.targetRpe ?? null,
                    }).then(reload);
                  }}
                  style={({ pressed }) => [
                    styles.addSet,
                    { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
                  ]}
                >
                  <Ionicons name="add" size={16} color={colors.warning} />
                  <Text variant="label" color="textSecondary">
                    Add warm-up
                  </Text>
                </Pressable>

                <Pressable
                  hitSlop={ADD_SET_SLOP}
                  onPress={() => {
                    haptics.selection();
                    const last = entry.sets[entry.sets.length - 1];
                    void addRoutineSet(entry.routineExercise.id, {
                      targetReps: last?.targetReps ?? null,
                      targetWeightKg: last?.targetWeightKg ?? null,
                      targetDurationSeconds: last?.targetDurationSeconds ?? null,
                      targetDistanceKm: last?.targetDistanceKm ?? null,
                      targetRpe: last?.targetRpe ?? null,
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

      <PromptModal
        visible={editingRoutineNotes}
        title="Routine notes"
        initialValue={detail.routine.notes ?? ''}
        placeholder="Add a note..."
        maxLength={500}
        multiline
        onCancel={() => setEditingRoutineNotes(false)}
        onConfirm={(value) => {
          setEditingRoutineNotes(false);
          void updateRoutine(id, { notes: value || null }).then(reload);
        }}
      />

      <PromptModal
        visible={!!editingExerciseNotesFor}
        title="Exercise notes"
        initialValue={detail.exercises.find(e => e.routineExercise.id === editingExerciseNotesFor)?.routineExercise.notes ?? ''}
        placeholder="Add a note..."
        maxLength={500}
        multiline
        onCancel={() => setEditingExerciseNotesFor(null)}
        onConfirm={(value) => {
          if (editingExerciseNotesFor) {
            const id = editingExerciseNotesFor;
            setEditingExerciseNotesFor(null);
            void updateRoutineExercise(id, { notes: value || null }).then(reload);
          } else {
            setEditingExerciseNotesFor(null);
          }
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
  notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  exerciseNotesField: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
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
  addSetRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  addSet: {
    flex: 1,
    height: 34,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actions: { padding: spacing.lg, gap: spacing.sm, marginTop: spacing.lg },
});
