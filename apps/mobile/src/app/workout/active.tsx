import { Ionicons } from '@expo/vector-icons';
import {
  formatDuration,
  isWorkingSet,
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
  type SetType,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, EmptyState, HeaderAction, Screen, StatBand, Text } from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { clearWorkoutNotice } from '@/features/notifications/workout';
import { ExerciseBlock } from '@/features/workouts/exercise-block';
import {
  cancelRestNotification,
  prepareRestNotifications,
  scheduleRestNotification,
  sweepRestNotifications,
} from '@/features/notifications/rest';
import { RestDurationSheet } from '@/features/workouts/rest-duration-sheet';
import { REST_BAR_HEIGHT, RestTimerBar } from '@/features/workouts/rest-timer-bar';
import { RestTimerSheet } from '@/features/workouts/rest-timer-sheet';
import {
  addExerciseToWorkout,
  addSet,
  canLogSet,
  deleteSet,
  discardWorkout,
  getPreviousPerformance,
  hasRestOverride,
  removeExerciseFromWorkout,
  resolveRestSeconds,
  restAfterSet,
  setExerciseRest,
  substituteExercise,
  updateSet,
  type PreviousPerformance,
  type SetInput,
  type WorkoutExerciseDetail,
} from '@/features/workouts/repository';
import { useTicker } from '@/hooks/use-ticker';
import { showAlert, showConfirm } from '@/store/dialog';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing, useColors } from '@/theme';

/** This screen's name on the picker's hand-off channel. */
const PICKER_ADDRESS = 'active-workout';

export default function ActiveWorkoutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Only ever one live session, so this screen is a singleton and needs no id
  // in its address — unlike the routine editor, which has one instance per
  // routine and has to say which one it is.
  const pendingExerciseIds = usePickedExercises(PICKER_ADDRESS);
  const clearPendingExercises = useExercisePicker((state) => state.clear);
  const openPicker = useExercisePicker((state) => state.open);

  const settings = useSettings();
  const startRest = useTimer((state) => state.startRest);
  const { guard, lostWrites } = useWriteGuard();

  /*
   * Keeps the screen on mid-set so the phone doesn't lock between reps.
   *
   * Not `useKeepAwake`: its tag argument is only a tag. It falls back to
   * `useId()` and activates either way, so the obvious-looking
   * `useKeepAwake(on ? tag : undefined)` kept the screen awake with the
   * setting off. The setting has to gate the call itself.
   *
   * Deactivation is caught because releasing a tag that is not held rejects on
   * native, and the settings store mounts with defaults before it hydrates from
   * SQLite — so a user who has this off still runs one activate/deactivate pair
   * on the way in.
   */
  useEffect(() => {
    if (!settings.keepAwakeDuringWorkout) return;
    activateKeepAwakeAsync('active-workout').catch(() => {});
    return () => {
      deactivateKeepAwake('active-workout').catch(() => {});
    };
  }, [settings.keepAwakeDuringWorkout]);

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
  const [previousByExercise, setPreviousByExercise] = useState<Record<string, PreviousPerformance>>(
    {},
  );

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

  /*
   * The slot a picker trip is meant to replace, when it is one.
   *
   * A ref rather than state, and held here rather than sent to the picker. The
   * picker is deliberately ignorant of who opened it, so the caller has to
   * remember what it asked for; and a re-render between "open the picker" and
   * "the ids arrived" would re-run the effect below against the same pending
   * list, which is how you end up adding an exercise twice.
   */
  const replacingLinkId = useRef<string | null>(null);

  // Exercises chosen in the picker arrive through the hand-off store.
  useEffect(() => {
    if (pendingExerciseIds.length === 0 || !workoutId) return;

    const replacing = replacingLinkId.current;
    replacingLinkId.current = null;

    guard(
      (async () => {
        const ids = [...pendingExerciseIds];

        // A replacement consumes one choice. Anything else tapped in the same
        // trip is still an exercise the user asked for, so it lands normally
        // rather than being thrown away.
        if (replacing) {
          const first = ids.shift();
          if (first) await substituteExercise(replacing, first);
        }

        for (const id of ids) {
          const created = await addExerciseToWorkout(workoutId, id);
          await addSet(created.id);
        }
        clearPendingExercises(PICKER_ADDRESS);
      })(),
    );
  }, [pendingExerciseIds, workoutId, clearPendingExercises, guard]);

  // Ask once when the logging screen first opens, rather than at app launch —
  // the permission prompt makes far more sense in context. The stale-bell sweep
  // rides along for the same reason: it needs the same "we are in a session"
  // moment, and moving it to bootstrap would drag notification setup back to
  // app start, which is what asking in context was avoiding.
  useEffect(() => {
    if (settings.restTimerEnabled && settings.restTimerNotifications) {
      void (async () => {
        await prepareRestNotifications();
        await sweepRestNotifications();
      })();
    }
  }, [settings.restTimerEnabled, settings.restTimerNotifications]);

  const completedSets = useMemo(
    () =>
      details.reduce(
        (total, detail) => total + detail.sets.filter((set) => set.isCompleted).length,
        0,
      ),
    [details],
  );

  /*
   * Set ids whose weight the user emptied by hand.
   *
   * A cleared field and one that was never touched are the same null in the
   * row, but only the untouched one means "same as last time". Every field edit
   * funnels through the one handler below, so this is the only place that can
   * tell the two apart. It resets if the screen unmounts, which degrades to the
   * old behaviour rather than to a new failure.
   *
   * Recorded for every tracking type, not just the ones where it changes an
   * outcome: the bookkeeping is a set insert, and keeping it type-blind means
   * "when does an empty box mean something?" is answered in exactly one place,
   * where the ghost is committed.
   */
  const clearedWeights = useRef<Set<string>>(new Set());

  const handleUpdateSet = useCallback(
    (setId: string, patch: Partial<WorkoutSet>) => {
      if ('weightKg' in patch) {
        if (patch.weightKg === null) clearedWeights.current.add(setId);
        else clearedWeights.current.delete(setId);
      }
      guard(updateSet(setId, patch));
    },
    [guard],
  );

  const handleToggleSet = useCallback(
    (set: WorkoutSet, detail: WorkoutExerciseDetail): Promise<boolean> => {
      if (set.isCompleted) {
        return guard(updateSet(set.id, { isCompleted: false }));
      }

      const fields = TRACKING_FIELDS[detail.exercise.trackingType];
      const previous = pairedPreviousSet(detail, previousByExercise[detail.exercise.id]?.sets, set);

      // `canLogSet` is the whole acceptance rule, and the set row runs the same
      // call to decide whether to tint before the write returns. Asking it here
      // rather than restating it is what keeps the plate and the screen from
      // disagreeing about which taps land.
      if (!canLogSet(fields, set, previous)) {
        haptics.rejected();
        return Promise.resolve(false);
      }

      /*
       * Commit the ghost.
       *
       * The weight and reps fields show last session's numbers as placeholders,
       * so "same as last week, tap the check" — the most common gesture there
       * is — used to complete a set holding two nulls: no volume, no PR, and a
       * summary that quietly disagreed with what happened. The numbers the user
       * was looking at are now written by the same tap that reads them.
       *
       * They go in `fill` rather than `patch`, so `updateSet` writes them as
       * COALESCE: a column that already holds a number keeps it. `set` here is
       * a render-old snapshot of the live query, and a weight typed a moment
       * ago may still be in flight — deciding "is this empty?" in JS would let
       * the ghost overwrite it. SQLite decides instead, against storage, at the
       * moment the statement runs.
       *
       * It folds into the *same* `updateSet` as `isCompleted`, so the row tints
       * and the digits land in one live-query pass rather than two.
       */
      const patch: SetInput = { isCompleted: true };
      const fill: SetInput = {};

      if (previous) {
        // An emptied weight is a fact only where an empty box can mean
        // something: "no belt" on weighted work, "no assistance" on assisted.
        // On a barbell lift it means nothing at all, so the placeholder's
        // promise stands and the ghost lands whether or not the box was touched.
        const clearedOnPurpose =
          USES_BODYWEIGHT.has(detail.exercise.trackingType) &&
          clearedWeights.current.has(set.id);
        if (fields.weight && !clearedOnPurpose) {
          fill.weightKg = previous.weightKg;
        }
        if (fields.reps) fill.reps = previous.reps;
        if (fields.duration) fill.durationSeconds = previous.durationSeconds;
        if (fields.distance) fill.distanceKm = previous.distanceKm;
      }

      /*
       * Everything the user can perceive happens before the write.
       *
       * The rest clock is the reason: it used to start after four SQLite
       * statements and a live-query round trip, so the countdown was already
       * behind the moment it appeared. Nothing here waits on the write: it goes
       * out through `guard`, whose outcome only the row consumes, to put its
       * plate back if the write never landed.
       */
      haptics.logged();

      // The live query has not refreshed yet, so "is the exercise finished?" is
      // answered from the rows already in hand plus the write just made — every
      // other set complete means this check was the last one.
      const finishesExercise =
        detail.sets.length > 0 &&
        detail.sets.every((other) => other.id === set.id || other.isCompleted);

      // Closing out an exercise used to raise a stats card over the screen. It
      // was information nobody had asked for, at the one moment the user is
      // mid-flow and reaching for the next set — the summary screen already
      // says all of it, afterwards, when there is time to read it. What is left
      // is a heavier tap than a set gets, and the block marking itself done in
      // place: the milestone is still acknowledged, it just no longer interrupts.
      if (finishesExercise) haptics.finished();

      if (settings.restTimerEnabled && settings.restTimerAutoStart) {
        // Scaled to the set just performed, not to the exercise: a warm-up is
        // capped and a set followed by a drop gets none at all. The kind rides
        // along so the bar can name the short number instead of looking broken.
        const plan = restAfterSet(detail, set, settings.defaultRestSeconds);

        if (plan.seconds > 0) {
          startRest(plan.seconds, {
            setId: set.id,
            exerciseId: detail.exercise.id,
            exerciseName: detail.exercise.name,
            kind: plan.kind,
          });

          // The in-app countdown only runs while foregrounded, so back it with a
          // scheduled notification for when the phone goes in a pocket.
          if (settings.restTimerNotifications) {
            void scheduleRestNotification(plan.seconds, detail.exercise.name);
          }
        } else {
          // `startRest` no-ops on a non-positive duration rather than clearing
          // what is running, so "no rest" has to be said explicitly or the
          // previous set's countdown sits over the drop.
          useTimer.getState().stopRest();
          void cancelRestNotification();
        }
      }

      return guard(updateSet(set.id, patch, fill));
    },
    [settings, startRest, previousByExercise, guard],
  );

  // Which exercise's rest is being edited, held by `workoutExercises.id` rather
  // than by the row itself so the sheet re-reads the live query's latest copy.
  const [restEditorId, setRestEditorId] = useState<string | null>(null);
  const restEditorDetail = details.find((detail) => detail.workoutExercise.id === restEditorId);

  // The exercise the running timer belongs to, so the bar can show and edit
  // that exercise's rest rather than the app default.
  const restExerciseId = useTimer((state) => state.restExerciseId);
  const restingDetail = details.find((detail) => detail.exercise.id === restExerciseId);

  const [timerSheetOpen, setTimerSheetOpen] = useState(false);

  /*
   * Whether the docked bar is occupying the bottom of the screen.
   *
   * A boolean selector rather than the clock itself: this re-renders the whole
   * logging screen, so it has to change twice a rest period — when the
   * countdown starts and when it clears — and never once a second. It exists
   * only to reserve scroll room, because the bar floats over the list rather
   * than sitting in it, and the last thing in that list is Discard workout.
   */
  const resting = useTimer(
    (state) => state.restEndsAt !== null || state.restPausedSeconds !== null,
  );

  const handleSaveRest = useCallback(
    (seconds: number | null) => {
      const detail = restEditorDetail;
      setRestEditorId(null);
      if (!detail) return;

      const before = resolveRestSeconds(detail, settings.defaultRestSeconds);
      const after = seconds ?? settings.defaultRestSeconds;

      guard(setExerciseRest(detail.workoutExercise.id, detail.exercise.id, seconds));

      // A timer already running for this exercise moves by the difference rather
      // than restarting: time already rested is still time rested, and someone
      // who stretches 2:00 to 3:00 halfway through means "a minute more", not
      // "start again".
      const timer = useTimer.getState();
      if (timer.restExerciseId === detail.exercise.id && timer.restEndsAt !== null) {
        timer.adjustRest(after - before);

        const next = useTimer.getState().restEndsAt;
        if (settings.restTimerNotifications && next !== null) {
          void scheduleRestNotification(Math.ceil((next - Date.now()) / 1000), detail.exercise.name);
        } else {
          void cancelRestNotification();
        }
      }
    },
    [restEditorDetail, settings.defaultRestSeconds, settings.restTimerNotifications, guard],
  );

  /*
   * Finishing and discarding both leave the screen, so both are latched.
   *
   * The ref is what actually closes the door — a second tap arrives before any
   * state has re-rendered — and the state exists so the header can dim and say
   * the session is on its way out rather than looking untouched.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  /*
   * Finish now *goes* somewhere rather than doing something.
   *
   * It used to raise a confirmation dialog and write the session on its OK —
   * which is a modal asking "are you sure?" about the one thing the user came
   * here to do, and it was also the only place the app admitted that unchecked
   * sets get dropped. Both belong on a screen with room for them, so the review
   * screen owns the confirmation, the name, the note and the write, and this is
   * a plain push.
   *
   * The empty-session check stays here anyway. It is two lines and it is the
   * difference between a rejection at the button the user pressed and a
   * rejection on a screen they were pushed to for no reason; the review screen
   * repeats it as a backstop for the session that empties underneath it.
   */
  const handleFinish = useCallback(() => {
    if (!workout || closingRef.current) return;

    const anyCompleted = details.some((detail) => detail.sets.some((set) => set.isCompleted));
    if (!anyCompleted) {
      haptics.rejected();
      void showAlert('Nothing logged', 'Complete at least one set before finishing.');
      return;
    }

    router.push('/workout/save');
  }, [workout, details]);

  const handleDiscard = useCallback(() => {
    if (!workout || closingRef.current) return;

    void (async () => {
      const confirmed = await showConfirm({
        title: 'Discard workout',
        message: 'This session will be deleted permanently.',
        confirmLabel: 'Discard',
      });
      if (!confirmed || closingRef.current) return;

      closingRef.current = true;
      setClosing(true);

      try {
        await discardWorkout(workout.id);
        useTimer.getState().stopRest();
        void cancelRestNotification();
        void clearWorkoutNotice();
        haptics.destructive();
        router.replace('/(tabs)/workout');
      } catch {
        closingRef.current = false;
        setClosing(false);
        haptics.rejected();
        void showAlert(
          'Could not discard',
          'The session is still open, and your sets are still here.',
        );
      }
    })();
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
            <View style={styles.headerActions}>
              {/*
                The clock, which is the only way to reach the timer when no
                rest is running: the docked bar exists for the countdown after
                a set, and between exercises there is nothing to tap. A glyph
                rather than a word because the pill beside it is the header's
                one primary action and two words at that end would read as two.
              */}
              <HeaderAction
                label="Rest timer"
                icon="stopwatch-outline"
                iconSize={22}
                onPress={() => {
                  haptics.selection();
                  setTimerSheetOpen(true);
                }}
              />
              <HeaderAction
                label="Finish workout"
                title="Finish"
                tone="success"
                variant="filled"
                disabled={closing}
                onPress={handleFinish}
              />
            </View>
          ),
        }}
      />

      <SessionStats startedAt={workout.startedAt} completedSets={completedSets} />

      {lostWrites > 0 && (
        /*
         * The one place the screen admits it is not writing. A full disk is the
         * realistic cause, and SQLITE_FULL blocks writes without blocking
         * reads — so the useful thing to offer is not a retry but the export,
         * which can still get the session off the phone intact.
         */
        <Pressable
          onPress={() => router.push('/export')}
          accessibilityRole="button"
          accessibilityLabel={`Not saving. ${lostWrites} ${
            lostWrites === 1 ? 'change' : 'changes'
          } lost`}
          accessibilityHint="Opens export, which still works"
          style={({ pressed }) => [styles.writeFailure, pressed && styles.pressed]}
        >
          <Text variant="label" color="danger">
            {`Not saving — ${lostWrites} ${lostWrites === 1 ? 'change' : 'changes'} lost`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.danger} />
        </Pressable>
      )}

      <ScrollView
        // The discard button is the last thing in the scroll, so the system
        // navigation inset is added to the content rather than the container.
        // The docked rest bar is added on top of it while one is running: it
        // floats over this list, and reserving its height only while it is
        // there costs a scroll that grows at the bottom — where nothing is
        // being read — instead of a permanent strip of dead space.
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.huge + insets.bottom + (resting ? REST_BAR_HEIGHT : 0) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // UIScrollView already scrolls the first responder into `bounds` minus
        // `contentInset`, so this single prop both creates the trailing slack
        // and lifts the focused row. Nothing else on this screen may move the
        // scroll: a second actor would fight UIKit and the user's thumb at once.
        automaticallyAdjustKeyboardInsets
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
                previousSets={previousByExercise[detail.exercise.id]?.sets ?? []}
                previousNote={previousByExercise[detail.exercise.id]?.note ?? null}
                onAddSet={() => {
                  // Carry the last set's load forward — the usual case is
                  // repeating the same weight for another set.
                  const last = detail.sets[detail.sets.length - 1];
                  haptics.added();
                  guard(
                    addSet(detail.workoutExercise.id, {
                      weightKg: last?.weightKg ?? null,
                      reps: last?.reps ?? null,
                      setType: 'normal',
                    }),
                  );
                }}
                onUpdateSet={handleUpdateSet}
                onToggleSet={(set) => handleToggleSet(set, detail)}
                onDeleteSet={(setId) => {
                  haptics.destructive();
                  guard(deleteSet(setId));
                }}
                onChangeSetType={(setId, setType: SetType) => {
                  haptics.selection();
                  guard(updateSet(setId, { setType }));
                }}
                onRemoveExercise={() => {
                  haptics.destructive();
                  guard(removeExerciseFromWorkout(detail.workoutExercise.id));
                }}
                onReplaceExercise={() => {
                  replacingLinkId.current = detail.workoutExercise.id;
                  openPicker(
                    PICKER_ADDRESS,
                    details.map((entry) => entry.exercise.id),
                  );
                  router.push('/exercise/picker');
                }}
                onEditNotes={(seed) => {
                  // The spread, not `seed: undefined`: params are serialised
                  // into the href, and an explicit undefined can arrive at the
                  // editor as the literal string "undefined". The plain "Add
                  // note" paths call this with nothing.
                  router.push({
                    pathname: '/workout/notes/[id]',
                    params: { id: detail.workoutExercise.id, ...(seed ? { seed } : {}) },
                  });
                }}
                onEditRest={() => setRestEditorId(detail.workoutExercise.id)}
                onOpenExercise={() => {
                  router.push({
                    pathname: '/exercise/[id]',
                    params: { id: detail.exercise.id },
                  });
                }}
              />
            </View>
          ))
        )}

        <View style={styles.actions}>
          <Button
            title="Add exercise"
            icon="add"
            fullWidth
            onPress={() => {
              // Backing out of the picker leaves the replacement request behind,
              // and the next trip would silently swap an exercise instead of
              // adding one. Opening the picker plainly cancels it.
              replacingLinkId.current = null;
              // What is already on the list travels with the request, so the
              // picker can offer what usually goes with it — and leave out what
              // is already there.
              openPicker(
                PICKER_ADDRESS,
                details.map((entry) => entry.exercise.id),
              );
              router.push('/exercise/picker');
            }}
          />
        </View>

        {/* Discard sits below a rule and a wide gap: a thumb that overshoots Add
            exercise should land on nothing, not on the end of the session. */}
        <Divider style={styles.discardRule} />
        <View style={styles.actions}>
          <Button
            title="Discard workout"
            variant="danger"
            fullWidth
            disabled={closing}
            onPress={handleDiscard}
          />
        </View>
      </ScrollView>

      {/* After the scroll, not before it: the bar is docked over the list now
          rather than sitting above it, so it has to paint last. */}
      <RestTimerBar onExpand={() => setTimerSheetOpen(true)} />

      <RestTimerSheet
        visible={timerSheetOpen}
        onClose={() => setTimerSheetOpen(false)}
        // Idle, the sheet still needs a number to offer, and the app default is
        // the honest one: with nothing resting there is no exercise whose rest
        // this would be.
        targetSeconds={
          restingDetail
            ? resolveRestSeconds(restingDetail, settings.defaultRestSeconds)
            : settings.defaultRestSeconds
        }
        onEditRest={
          restingDetail
            ? () => {
                // The duration editor is itself a `Modal`, and Android does not
                // stack two of those reliably — the same reason the measurement
                // screen drops its sheet before confirming a delete. So this one
                // goes down first and the editor comes up in its place.
                setTimerSheetOpen(false);
                setRestEditorId(restingDetail.workoutExercise.id);
              }
            : undefined
        }
      />

      {restEditorDetail && (
        <RestDurationSheet
          visible
          exerciseName={restEditorDetail.exercise.name}
          value={resolveRestSeconds(restEditorDetail, settings.defaultRestSeconds)}
          usingDefault={!hasRestOverride(restEditorDetail)}
          defaultSeconds={settings.defaultRestSeconds}
          onCancel={() => setRestEditorId(null)}
          onSave={handleSaveRest}
        />
      )}
    </Screen>
  );
}

/**
 * Fire-and-forget writes that say so when they fail.
 *
 * Every write on this screen was a bare `void promise`: a disk that has run out
 * of room rejects all of them, and the user keeps lifting into a log that is no
 * longer recording. The counter is deliberately a count of lost changes rather
 * than a queue — nothing here is worth retrying automatically, because the
 * failure is a property of the device, not of the statement.
 *
 * A success clears the count. Anything that writes at all means the disk let go.
 *
 * The settled outcome comes back so a caller that showed something optimistic
 * can take it down again: the check-off does, and every other call site ignores
 * the value. Without it a row stays green over a set the database never got,
 * one line below the banner saying the screen is not saving.
 */
function useWriteGuard() {
  const [lostWrites, setLostWrites] = useState(0);

  const guard = useCallback(
    (promise: Promise<unknown>): Promise<boolean> =>
      promise.then(
        () => {
          setLostWrites(0);
          return true;
        },
        () => {
          haptics.rejected();
          setLostWrites((count) => count + 1);
          return false;
        },
      ),
    [],
  );

  return { guard, lostWrites };
}

/**
 * The session's two figures, and the only thing on this screen that ticks.
 *
 * `useTicker` used to sit at the screen root, so once a second the whole tree
 * re-rendered: every exercise block, every set row, every text field in them.
 * A set row is a controlled input — competing with a full re-render every
 * second is what made typing a weight feel like it was fighting back. Owning
 * the ticker here confines the 1Hz update to this one band.
 *
 * Volume used to sit alongside these two and now doesn't: the summary screen
 * states it thirty seconds later, and three figures forced the band's type down
 * a step for a number nobody acts on mid-set.
 */
function SessionStats({ startedAt, completedSets }: { startedAt: Date; completedSets: number }) {
  const now = useTicker(1000);
  const elapsed = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));

  return (
    <StatBand
      style={styles.stats}
      items={[
        { label: 'Duration', value: formatDuration(elapsed), lead: true },
        { label: 'Sets', value: String(completedSets) },
      ]}
    />
  );
}

/**
 * Last session's counterpart to a set, paired the way the block displays it.
 *
 * Warm-ups and working sets run as two independent sequences, so today's first
 * working set is paired with last week's first working set even if one session
 * warmed up twice and the other three times. Pairing on the raw array index put
 * a top set against a bar-only warm-up and offered it as the number to commit.
 *
 * Undefined when today has more sets of a class than last time did. There is no
 * "repeat the last one" fallback: a fifth set has no counterpart, and inventing
 * one would put a number under the check that was never performed.
 */
function pairedPreviousSet(
  detail: WorkoutExerciseDetail,
  previousSets: WorkoutSet[] | undefined,
  set: WorkoutSet,
): WorkoutSet | undefined {
  if (!previousSets || previousSets.length === 0) return undefined;

  const working = isWorkingSet(set.setType);
  const sameClass = (candidate: WorkoutSet) => isWorkingSet(candidate.setType) === working;

  let ordinal = 0;
  for (const row of detail.sets) {
    if (row.id === set.id) break;
    if (sameClass(row)) ordinal += 1;
  }

  return previousSets.filter(sameClass)[ordinal];
}

const styles = StyleSheet.create({
  stats: {
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  writeFailure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  // Two actions at the same end of the header, so they need a gap of their own:
  // each one's frame already reaches inwards for its touch target, and without
  // this the clock's frame and the Finish pill's would meet.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scroll: { paddingBottom: spacing.huge },
  actions: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  discardRule: { marginTop: spacing.xxxl },
});
