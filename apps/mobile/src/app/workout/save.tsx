import {
  DATE_MEDIUM,
  formatDateTime,
  formatDuration,
  formatVolume,
  summarizeSets,
  type AnalyticsContext,
  type SetLike,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  EmptyState,
  HeaderAction,
  ListRow,
  Screen,
  StatBand,
  Text,
  TextField,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { cancelRestNotification } from '@/features/notifications/rest';
import { clearWorkoutNotice } from '@/features/notifications/workout';
import { discardWorkout, finishWorkout } from '@/features/workouts/repository';
import { useTicker } from '@/hooks/use-ticker';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing } from '@/theme';

/** One exercise of the session, reduced to what the totals need. */
interface SessionEntry {
  trackingType: TrackingType;
  sets: WorkoutSet[];
}

/**
 * The last look at a session before it is closed out.
 *
 * Finishing used to happen straight from the logging screen's header, behind a
 * confirmation dialog: one tap, a modal listing the sets about to be dropped,
 * and the workout was in the log. That put the two things people actually want
 * to change about a session — what it is called, and a line about how it went —
 * behind a rename on a screen they had to find afterwards, and it spent the
 * dialog on a number nobody could act on from inside a modal.
 *
 * So the dialog is gone and this screen has its job. It is the confirmation:
 * arriving here is the pause, Save is the affirmative act, and the back chevron
 * is the way out — it returns to a session that is still open and still
 * running, because nothing on this screen writes until Save does.
 */
export default function SaveWorkoutScreen() {
  const scrollEdge = useScrollEdge();

  const insets = useSafeAreaInsets();

  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);
  const weightUnit = useSettings((state) => state.weightUnit);

  // The same query the logging screen runs, for the same reason: there is only
  // ever one open session, so this screen is a singleton and takes no id in its
  // route. Passing one would also let the two screens disagree — a session
  // finished in another tab would leave this one holding an id it could still
  // name but no longer save.
  const { data: activeRows = [], updatedAt } = useLiveQuery(
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
      .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
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
      ),
    [linkKey],
  );

  // Only the tracking type is wanted from the exercise itself — it decides how a
  // set is valued — so this asks for the handful of rows the session uses rather
  // than the ~6,800-row catalog. See the note on the same query in `active.tsx`.
  const exerciseIds = links.map((link) => link.exerciseId);
  const exerciseIdsKey = exerciseIds.join(',');

  const { data: exerciseRows = [] } = useLiveQuery(
    db
      .select({ id: exercisesTable.id, trackingType: exercisesTable.trackingType })
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds.length > 0 ? exerciseIds : ['__none__'])),
    [exerciseIdsKey],
  );

  const entries = useMemo<SessionEntry[]>(() => {
    const trackingById = new Map(exerciseRows.map((row) => [row.id, row.trackingType]));
    const setsByParent = new Map<string, WorkoutSet[]>();

    for (const set of sets) {
      const bucket = setsByParent.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsByParent.set(set.workoutExerciseId, [set]);
    }

    // A link whose exercise row has gone is skipped, matching `getWorkoutDetail`
    // — which is what `finishWorkout` reads through, so an orphan is absent from
    // the totals it stores too. The figures here have to be the ones about to be
    // written, not a second opinion on them.
    return links.flatMap((link) => {
      const trackingType = trackingById.get(link.exerciseId);
      if (!trackingType) return [];
      return [{ trackingType, sets: setsByParent.get(link.id) ?? [] }];
    });
  }, [links, sets, exerciseRows]);

  /**
   * The figures this screen reports, derived exactly as `finishWorkout` derives
   * the ones it stores: `summarizeSets` per exercise, under that exercise's
   * tracking type, with the bodyweight and one-rep-max formula from settings. A
   * screen that computed "volume" its own way would be a second definition of
   * the word, and the two would drift the first time either changed.
   *
   * `Sets` is therefore `workingSets` — completed working sets, warm-ups
   * excluded — which is what lands in the row and what the summary screen shows
   * a tap later. The logging screen counts every checked box including warm-ups,
   * and that is the right number *while lifting*: it answers "how much have I
   * done", not "what is going into the log".
   *
   * `completed` is the whole count, warm-ups included, because it answers a
   * different question — whether anything was logged at all — and a session of
   * nothing but warm-ups is still a session with sets in it.
   */
  const totals = useMemo(() => {
    let volumeKg = 0;
    let workingSets = 0;
    let completed = 0;
    let unchecked = 0;

    for (const entry of entries) {
      for (const set of entry.sets) {
        if (set.isCompleted) completed += 1;
        else unchecked += 1;
      }

      const ctx: AnalyticsContext = {
        trackingType: entry.trackingType,
        bodyweightKg: bodyweightKg ?? undefined,
        formula,
      };

      const summary = summarizeSets(entry.sets as SetLike[], ctx);
      volumeKg += summary.volumeKg;
      workingSets += summary.workingSets;
    }

    return { volumeKg, workingSets, completed, unchecked };
  }, [entries, bodyweightKg, formula]);

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  /*
   * The fields are seeded once per session, not kept in step with the row.
   *
   * The live query re-emits on every write to `workouts`, and each emission is a
   * fresh object — so an effect that followed the row would put the stored name
   * back into the field between two keystrokes. Once seeded the text belongs to
   * the user until Save; the id guard is what makes "the same row again" and "a
   * different session" distinguishable.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!workout || seededFor.current === workout.id) return;
    seededFor.current = workout.id;
    setName(workout.name);
    setNotes(workout.notes ?? '');
  }, [workout]);

  /*
   * Saving and discarding both leave the screen, so both are latched — the same
   * pair the logging screen uses. The ref closes the door, because a second tap
   * arrives before any state has re-rendered; the state exists so the header can
   * dim and say the session is on its way out rather than looking untouched.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const handleSave = useCallback(() => {
    if (!workout || closingRef.current) return;

    // The logging screen's rule, restated rather than inherited: this screen is
    // now the only route to a finished session, so the rule has to hold here or
    // it does not hold anywhere.
    if (totals.completed === 0) {
      haptics.rejected();
      void showAlert('Nothing logged', 'Complete at least one set before saving.');
      return;
    }

    // Latched in the same tick as the tap, unlike the confirmation this replaces:
    // there is no dialog in front of Save any more, so nothing can land between
    // the check and the write.
    closingRef.current = true;
    setClosing(true);

    void (async () => {
      try {
        // The name goes through untrimmed. `finishWorkout` decides what an empty
        // one means — it keeps the existing name — and stating that rule twice is
        // how the two copies of it start to disagree.
        const result = await finishWorkout(workout.id, {
          bodyweightKg: bodyweightKg ?? undefined,
          formula,
          name,
          notes: notes.trim() || null,
        });

        useTimer.getState().stopRest();
        void cancelRestNotification();
        void clearWorkoutNotice();
        haptics.finished();
        router.replace({
          pathname: '/workout/summary/[id]',
          params: { id: result.workout.id },
        });
      } catch {
        closingRef.current = false;
        setClosing(false);
        haptics.rejected();
        void showAlert(
          'Could not save',
          'The session stayed open. Your sets are still here — try again in a moment.',
        );
      }
    })();
  }, [workout, totals.completed, bodyweightKg, formula, name, notes]);

  const handleDiscard = useCallback(() => {
    if (!workout || closingRef.current) return;

    void (async () => {
      const confirmed = await showConfirm({
        title: 'Discard workout',
        message: 'This session will be deleted permanently.',
        confirmLabel: 'Discard',
      });
      // The latch is re-read rather than trusted: this spans an await, and a
      // notification tap can put the user back on the session inside that window.
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

  // Declared once and rendered in both branches, like the summary screen: a
  // native-stack screen reads its options as the push animation starts, so
  // setting them only in the loaded branch slides a differently titled header in
  // and relabels it mid-transition.
  const header = (
    <Stack.Screen
      options={{
        title: 'Save workout',
        headerRight: workout
          ? () => (
              // Filled, which `HeaderActionVariant` reserves for the one action a
              // screen exists to complete — this is that screen. The label names
              // the object as well as the verb, because "Save" alone could be the
              // name, the note, or the session.
              <HeaderAction
                label="Save workout"
                title="Save"
                variant="filled"
                disabled={closing}
                onPress={handleSave}
              />
            )
          : undefined,
      }}
    />
  );

  if (!workout) {
    /*
     * Two ways to have no session, and only one of them is worth saying.
     *
     * `updatedAt` is undefined until the first read lands, so the mount frame
     * has no row yet — announcing "no active workout" there would flash the
     * failure state over a session that is right behind this screen. And a save
     * or a discard drops the row from this query before the navigation runs, so
     * `closing` covers the frames between the write and the new screen.
     */
    const settled = updatedAt !== undefined && !closing;

    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        {settled && (
          <EmptyState
            icon="barbell-outline"
            title="No active workout"
            description="Nothing to save — this session was finished or discarded somewhere else."
            action={
              <Button title="Go to Workout" onPress={() => router.replace('/(tabs)/workout')} />
            }
          />
        )}
      </Screen>
    );
  }

  const uncheckedNoun = totals.unchecked === 1 ? 'set' : 'sets';

  const startedAt = formatDateTime(workout.startedAt, DATE_MEDIUM);

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      <ScrollView
        {...scrollEdge.list}
        // Discard is the last thing in the scroll, so the system navigation
        // inset is added to the content rather than to the container.
        contentContainerStyle={[styles.content, { paddingBottom: spacing.huge + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        // UIScrollView already scrolls the first responder into `bounds` minus
        // `contentInset`, so this one prop both creates the trailing slack and
        // lifts the focused field. Same arrangement as the logging screen.
        automaticallyAdjustKeyboardInsets
      >
        {totals.unchecked > 0 && (
          /* The one sentence the confirmation dialog contributed, kept because
             it is the only thing Save does that the user cannot see. It sits at
             the top of the body because Save is in the header, and this is the
             closest the scroll gets to it — and because it is read before the
             fields rather than after them, while there is still time to go back
             and check a box. `dropped`, not `discarded`: the repository's own
             word, and "discard" stays reserved for the whole session. */
          <Text variant="caption" color="warning">
            {`${totals.unchecked} unchecked ${uncheckedNoun} will be dropped.`}
          </Text>
        )}

        {/* The stored name as the placeholder, not as a fallback nobody sees:
            emptying the field shows what the session will still be called. */}
        <TextField
          label="Name"
          accessibilityLabel="Workout name"
          value={name}
          onChangeText={setName}
          placeholder={workout.name}
          maxLength={80}
          returnKeyType="done"
        />

        <SessionStats
          startedAt={workout.startedAt}
          volumeKg={totals.volumeKg}
          workingSets={totals.workingSets}
          weightUnit={weightUnit}
        />

        <TextField
          label="Description"
          accessibilityLabel="Workout description"
          value={notes}
          onChangeText={setNotes}
          placeholder="How did it go?"
          multiline
          style={styles.description}
        />

        {/*
         * Informational, and deliberately not a control.
         *
         * The reference design opens a date picker here. This app has no
         * date-picker dependency, and a row that wears a chevron and opens
         * nothing is worse than a row with no chevron: it is a promise the
         * screen cannot keep, found by the one user who needed it. Backdating a
         * session is also not what this screen is for — it reports when the
         * session started, which is a fact the app recorded rather than a field.
         * If editing the start time is ever wanted, it wants a picker and a rule
         * for what happens to the duration, not a tap target added here.
         */}
        <Card padded={false}>
          <ListRow
            icon="calendar-outline"
            title={startedAt}
            subtitle="Started"
            showChevron={false}
          />
        </Card>

        {/* Set apart by a wide gap rather than tucked under the fields: it is
            the one irreversible thing on the screen, and a thumb travelling to
            the description should not be able to overshoot onto it. */}
        <Button
          title="Discard workout"
          variant="danger"
          fullWidth
          disabled={closing}
          onPress={handleDiscard}
          style={styles.discard}
        />
      </ScrollView>
    </Screen>
  );
}

/**
 * The session's three figures, and the only thing on this screen that ticks.
 *
 * The ticker is owned here rather than at the screen root for the reason the
 * logging screen's `SessionStats` records: a `useTicker` at the top re-renders
 * the whole tree once a second, and this screen holds two controlled text
 * fields. Typing a workout note against a re-render every second is the same
 * fight a weight field used to put up mid-set. Confined here, the 1Hz update
 * costs one band.
 *
 * Duration leads because it is the figure still moving — the other two are
 * settled the moment the last set was checked off, and only the clock is a
 * reason to look at this band twice.
 */
function SessionStats({
  startedAt,
  volumeKg,
  workingSets,
  weightUnit,
}: {
  startedAt: Date;
  volumeKg: number;
  workingSets: number;
  weightUnit: WeightUnit;
}) {
  const now = useTicker(1000);
  const elapsed = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));

  // Split so the band can set the unit small and quiet beside the figure; the
  // formatters return the two joined, which is right for a sentence and wrong
  // for a column. See `splitMeasure`.
  const [volume, volumeUnit] = splitMeasure(formatVolume(volumeKg, weightUnit));

  return (
    <StatBand
      items={[
        { label: 'Duration', value: formatDuration(elapsed), lead: true },
        { label: 'Volume', value: volume, unit: volumeUnit },
        { label: 'Sets', value: String(workingSets) },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  // Tall enough for a few lines, and top-aligned: a multiline `TextInput`
  // centres its text vertically on Android otherwise, so a one-line note floats
  // in the middle of the box. Matches the per-exercise note editor.
  description: { height: 120, paddingTop: spacing.md, textAlignVertical: 'top' },
  discard: { marginTop: spacing.xxl },
});
