import { Ionicons } from '@expo/vector-icons';
import {
  calculatePlates,
  defaultPlates,
  formatDuration,
  formatWeight,
  isWorkingSet,
  nearestLoadable,
  TRACKING_FIELDS,
  type SetType,
  type WeightUnit,
} from '@lift/shared';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

import { SetRow } from './set-row';
import { hasRestOverride, resolveRestSeconds, type WorkoutExerciseDetail } from './repository';

export interface ExerciseBlockProps {
  detail: WorkoutExerciseDetail;
  previousSets: WorkoutSet[];
  /**
   * The most recent note written against this exercise in an earlier session.
   * Shown only when this block has no note of its own.
   */
  previousNote?: string | null;
  onAddSet: () => void;
  onUpdateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  onToggleSet: (set: WorkoutSet) => void;
  onDeleteSet: (setId: string) => void;
  onChangeSetType: (setId: string, setType: SetType) => void;
  onRemoveExercise: () => void;
  /** Swaps this slot for another exercise — the bench is taken, the pin is missing. */
  onReplaceExercise: () => void;
  /** `seed` prefills the editor; recalling last session's note must not overwrite it in place. */
  onEditNotes: (seed?: string) => void;
  onEditRest: () => void;
  /** Opens the exercise's own page — history, records and charts. */
  onOpenExercise: () => void;
}

/**
 * Asymmetric on purpose, and never mirrored between horizontal neighbours.
 * Overlapping slop is not shared: the later sibling wins the hit test, so two
 * controls that both reach 8pt toward each other turn the band between them
 * into a silent thief. The rest chip reaches back into the gap it owns and only
 * grazes the menu; the menu takes the whole right margin, where nothing else is.
 */
const REST_SLOP = { top: 12, bottom: 12, left: 6, right: 4 };
const MENU_SLOP = { top: 12, bottom: 12, left: 4, right: 16 };
const ADD_SET_SLOP = { top: 8, bottom: 8 };

export function ExerciseBlock({
  detail,
  previousSets,
  previousNote,
  onAddSet,
  onUpdateSet,
  onToggleSet,
  onDeleteSet,
  onChangeSetType,
  onRemoveExercise,
  onReplaceExercise,
  onEditNotes,
  onEditRest,
  onOpenExercise,
}: ExerciseBlockProps) {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);
  const barWeightKg = useSettings((state) => state.barWeightKg);
  const defaultRestSeconds = useSettings((state) => state.defaultRestSeconds);
  const restTimerEnabled = useSettings((state) => state.restTimerEnabled);

  const restSeconds = resolveRestSeconds(detail, defaultRestSeconds);
  // A rest the user chose is stated in the accent; one that is merely the app
  // default stays quiet, so the header reads as "set" versus "inherited".
  const restIsExplicit = hasRestOverride(detail);

  const fields = TRACKING_FIELDS[detail.exercise.trackingType];

  // Every set checked off. This used to raise a card over the whole screen; now
  // the block says it itself, in the header, and the user carries on.
  const allComplete =
    detail.sets.length > 0 && detail.sets.every((set) => set.isCompleted);

  const rows = pairWithPrevious(detail.sets, previousSets);

  // What to load for the set the user is walking to the rack to do. Barbells
  // only: a dumbbell has no per-side arithmetic, and the Smith machine is left
  // out on purpose because its counterbalance runs anywhere from 0 to 20 kg
  // between machines, so a confident number at the rack would be wrong more
  // often than right. The app has had this engine since launch, three
  // navigations and a retyped weight away under the Profile tab.
  const plateLine = useMemo(() => {
    if (detail.exercise.equipment !== 'barbell') return null;

    const next = detail.sets.find((set) => !set.isCompleted);
    if (next?.weightKg == null || next.weightKg <= 0) return null;

    return describePlates(next.weightKg, barWeightKg, weightUnit);
  }, [detail.exercise.equipment, detail.sets, barWeightKg, weightUnit]);

  const confirmRemove = () => {
    Alert.alert('Remove exercise', `Remove ${detail.exercise.name} from this workout?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onRemoveExercise },
    ]);
  };

  // Notes moved here when the title became a link to the exercise page, and
  // Replace joined them when substitution stopped meaning "delete and re-add".
  //
  // Android keeps only the *first three* buttons (`Alert.js` slices the array
  // before mapping them onto neutral/negative/positive) and drops the rest in
  // silence, so Cancel goes last and is the one that goes missing there. That
  // costs nothing as long as the dialog can still be dismissed, which is why
  // `cancelable` is passed explicitly — React Native defaults it to false on
  // Android, and a dialog with no visible Cancel and no scrim dismiss is a
  // trap. iOS shows all four and floats the cancel-styled one to the bottom
  // regardless of its position here. Rest keeps its own chip in the header.
  const openMenu = () => {
    Alert.alert(
      detail.exercise.name,
      undefined,
      [
        { text: 'Replace exercise', onPress: onReplaceExercise },
        {
          text: detail.workoutExercise.notes ? 'Edit note' : 'Add note',
          onPress: () => onEditNotes(),
        },
        { text: 'Remove exercise', style: 'destructive', onPress: confirmRemove },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.titleRow, pressed && styles.pressed]}
          onPress={onOpenExercise}
          accessibilityRole="link"
          // The badge is decorative; the state it reports has to reach a screen
          // reader through the label of the control it sits in.
          accessibilityLabel={
            `${detail.exercise.name}.` +
            `${allComplete ? ' Complete.' : ''} View history and records`
          }
        >
          {/* Subheading, and no accent. This is the only heading on the screen
              that names what you are doing, and at body size it was lighter
              than the numbers inside its own set rows — which is why six
              exercises scrolled as one undifferentiated column. The accent is
              budgeted at roughly one element per view (`theme/tokens.ts`) and
              this screen was spending it once per exercise. */}
          <Text variant="subheading" color="text" numberOfLines={1} style={styles.title}>
            {detail.exercise.name}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />

          {/* The slot is always laid out, so the badge arriving mid-session
              doesn't shove the rest of the header sideways under the user's
              thumb. It sits with the name because that is what it is about. */}
          <View style={styles.doneSlot}>
            {allComplete && (
              <Animated.View
                entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
                exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
              >
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              </Animated.View>
            )}
          </View>
        </Pressable>

        {restTimerEnabled && (
          <Pressable
            onPress={onEditRest}
            hitSlop={REST_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Rest after ${detail.exercise.name}, ${formatDuration(restSeconds)}. Edit`}
            style={({ pressed }) => [
              styles.rest,
              {
                backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
              },
            ]}
          >
            <Ionicons
              name="timer-outline"
              size={12}
              color={restIsExplicit ? colors.accent : colors.textTertiary}
            />
            <Text
              variant="caption"
              style={{ color: restIsExplicit ? colors.accent : colors.textTertiary }}
            >
              {formatDuration(restSeconds)}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={openMenu}
          hitSlop={MENU_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${detail.exercise.name}`}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {detail.workoutExercise.notes ? (
        <Pressable
          onPress={() => onEditNotes()}
          style={({ pressed }) => [styles.notes, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Note: ${detail.workoutExercise.notes}`}
          accessibilityHint="Edits this note"
        >
          <Text variant="label" color="textSecondary">
            {detail.workoutExercise.notes}
          </Text>
        </Pressable>
      ) : previousNote ? (
        /* A cue is sticky — "pin 4, not 5" stays true until it doesn't — so the
           standing instruction is put back in front of the user instead of
           being retyped from memory. Dimmer than a note written today, and it
           stays a quotation until the user accepts it: tapping seeds the editor
           rather than writing it onto this session behind their back. Upright,
           not italic; only upright cuts are loaded, so an italic
           style would synthesise or fall back. */
        <Pressable
          onPress={() => onEditNotes(previousNote)}
          style={({ pressed }) => [styles.notes, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Note from last time: ${previousNote}`}
          accessibilityHint="Opens the note editor with this text"
        >
          <Text variant="label" color="textTertiary" numberOfLines={2}>
            Last time — {previousNote}
          </Text>
        </Pressable>
      ) : null}

      {/* Column headings. `overline` uppercases and adds tracking, so these are
          written in sentence case — the same rule every other heading follows. */}
      <View style={styles.columnHeader}>
        <Text variant="overline" color="textTertiary" style={styles.indexCell}>
          Set
        </Text>
        <Text variant="overline" color="textTertiary" style={styles.previousCell}>
          Previous
        </Text>
        {fields.weight && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            {weightUnit}
          </Text>
        )}
        {fields.duration && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Time
          </Text>
        )}
        {fields.distance && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Km
          </Text>
        )}
        {fields.reps && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Reps
          </Text>
        )}
        <View style={styles.checkSpacer} />
      </View>

      {plateLine && (
        <Text
          variant="numeric"
          color="textTertiary"
          style={styles.plateLine}
          accessibilityLabel={plateLine.label}
        >
          {plateLine.text}
        </Text>
      )}

      {rows.map(({ set, workingIndex, previous }) => (
        <SetRow
          key={set.id}
          set={set}
          workingIndex={workingIndex}
          trackingType={detail.exercise.trackingType}
          previous={previous}
          onChange={(patch) => onUpdateSet(set.id, patch)}
          onToggleComplete={() => onToggleSet(set)}
          onDelete={() => onDeleteSet(set.id)}
          onChangeSetType={(setType) => onChangeSetType(set.id, setType)}
        />
      ))}

      <Pressable
        onPress={onAddSet}
        hitSlop={ADD_SET_SLOP}
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
  );
}

interface SetRowModel {
  set: WorkoutSet;
  /** 1-based ordinal among working sets; a warm-up carries the count so far. */
  workingIndex: number;
  /** The set that occupied this ordinal last session, if there was one. */
  previous: WorkoutSet | undefined;
}

/**
 * Lines today's sets up with last session's, by ordinal **within set class**.
 *
 * Pairing by raw array position compares today's first working set against last
 * week's second warm-up the moment the two sessions disagree about how many
 * warm-ups they had — which is most of the time — and everything downstream of
 * the pairing goes quietly wrong with it: the Previous column, the placeholder
 * built from it, and any warm-up ramp that reads the same numbers later.
 *
 * A class that runs out has no partner and is left undefined. Repeating the
 * last set to fill the gap would put a number the user never lifted in front of
 * them, in the one column they trust to be a record of what happened.
 *
 * Warm-ups don't consume a working-set number either, so the ordinal shown in
 * the set column is counted here rather than taken from the array index.
 */
function pairWithPrevious(sets: WorkoutSet[], previousSets: WorkoutSet[]): SetRowModel[] {
  const previousWorking = previousSets.filter((set) => isWorkingSet(set.setType));
  const previousWarmups = previousSets.filter((set) => !isWorkingSet(set.setType));

  let working = 0;
  let warmup = 0;

  return sets.map((set) => {
    if (isWorkingSet(set.setType)) {
      working += 1;
      return { set, workingIndex: working, previous: previousWorking[working - 1] };
    }

    warmup += 1;
    return { set, workingIndex: working, previous: previousWarmups[warmup - 1] };
  });
}

/**
 * One line of plate maths: the bar, then what goes on each side.
 *
 * Two shapes, because the honest answer has two shapes. When the weight can be
 * made, it is the loading — `20 + 25 · 10 · 2.5 per side`. When it can't, it is
 * the two weights either side of it — `102.5 → 100 / 105` — which is the only
 * question `nearestLoadable` was ever written to answer.
 *
 * The spoken label is built alongside the printed one rather than derived from
 * it, because `·` and `×` are read out inconsistently and a screen reader
 * should hear "25 times 2" rather than "25 multiplication sign 2".
 */
function describePlates(
  targetKg: number,
  barKg: number,
  unit: WeightUnit,
): { text: string; label: string } | null {
  const inventory = defaultPlates(unit);
  const show = (kg: number) => formatWeight(kg, unit, { withUnit: false });
  const result = calculatePlates(targetKg, barKg, inventory);

  // Under the bar means the user is on a bar this app doesn't know about — a
  // 15 kg women's bar, a fixed EZ curl bar — and every number that follows
  // would be built on the wrong one. Same rule as the Smith machine: silence.
  if (result.belowBar) return null;

  if (!result.exact) {
    const { below, above } = nearestLoadable(targetKg, barKg, inventory);
    return {
      text: `${show(targetKg)} → ${show(below)} / ${show(above)}`,
      label: `${show(targetKg)} ${unit} is not loadable. Nearest are ${show(below)} and ${show(above)} ${unit}.`,
    };
  }

  if (result.plates.length === 0) {
    return { text: 'Empty bar', label: `Empty bar, ${show(barKg)} ${unit}.` };
  }

  const parts = result.plates.map((plate) => {
    const weight = show(plate.weightKg);
    if (plate.perSide === 1) return { text: weight, spoken: weight };
    return { text: `${weight} × ${plate.perSide}`, spoken: `${weight} times ${plate.perSide}` };
  });

  return {
    text: `${show(barKg)} + ${parts.map((part) => part.text).join(' · ')} per side`,
    label: `Bar ${show(barKg)} ${unit}, plus ${parts.map((part) => part.spoken).join(', ')} per side.`,
  };
}

const styles = StyleSheet.create({
  block: { paddingVertical: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    // Eight rather than twelve. The chip and the menu each reach 4pt toward the
    // other, so this is the width that lets their slop meet without overlapping
    // — and the title needs every point back now that it is set at subheading.
    gap: spacing.sm,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  doneSlot: { width: 16, alignItems: 'center' },
  // Shrinks before the chevron does, so a long exercise name truncates instead
  // of pushing the affordance off the row. At subheading size a 390pt screen
  // leaves about 230pt here, which takes "Barbell Bulgarian Split Squat" down
  // to "Barbell Bulgarian Split…" — still enough to tell two variations of the
  // same lift apart, which is the whole job of the name.
  title: { flexShrink: 1 },
  rest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  notes: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  indexCell: { width: 32, textAlign: 'center' },
  previousCell: { flex: 1, minWidth: 60 },
  unitCell: { width: 62, textAlign: 'center' },
  checkSpacer: { width: 38 },
  plateLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
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
  pressed: { opacity: 0.6 },
});
