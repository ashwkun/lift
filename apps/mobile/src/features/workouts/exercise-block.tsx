import { Ionicons } from '@expo/vector-icons';
import {
  calculatePlates,
  defaultPlates,
  DISTANCE_UNITS,
  formatDuration,
  formatWeight,
  isWorkingSet,
  nearestLoadable,
  TRACKING_FIELDS,
  WEIGHT_UNITS,
  type DistanceUnit,
  type SetType,
  type Suggestion,
  type WeightUnit,
} from '@lift/shared';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { useExerciseUnits } from '@/features/exercises/units';
import { haptics } from '@/features/feedback/haptics';
import { showConfirm, showDialog } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

import { pairWithPrevious } from './previous';
import { SetRow } from './set-row';
import { hasRestOverride, resolveRestSeconds, type WorkoutExerciseDetail } from './repository';
import { suggestForExercise, type ProgressionInput } from './suggestion';

export interface ExerciseBlockProps {
  detail: WorkoutExerciseDetail;
  previousSets: WorkoutSet[];
  /**
   * The most recent note written against this exercise in an earlier session.
   * Shown only when this block has no note of its own.
   */
  previousNote?: string | null;
  /**
   * What the progression engine gets to read: this exercise's recent sessions,
   * plus the routine's prescription if the session came from one.
   *
   * Optional, and that is the whole opt-in. A session being planned is offered
   * a target; a session being *corrected* — the editor, months later — is not,
   * because it is a record of what happened rather than a plan, and there is
   * nothing left to progress into. That screen passes nothing and no line
   * renders. See `suggestion.ts`.
   */
  progression?: ProgressionInput;
  onAddSet: () => void;
  onUpdateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  onToggleSet: (set: WorkoutSet) => void;
  onDeleteSet: (setId: string) => void;
  onChangeSetType: (setId: string, setType: SetType) => void;
  onRemoveExercise: () => void;
  /** Swaps this slot for another exercise — the bench is taken, the pin is missing. */
  onReplaceExercise: () => void;
  /**
   * Opens the reorder sheet for the whole session.
   *
   * A list-level action reached from a per-exercise menu, deliberately: the
   * moment you want it is the moment you are looking at the block that is in
   * the wrong place, and that block's menu is already under your thumb.
   */
  onReorder: () => void;
  /** `seed` prefills the editor; recalling last session's note must not overwrite it in place. */
  onEditNotes: (seed?: string) => void;
  onEditRest: () => void;
  /**
   * Changes the units this exercise is read in — see `setExerciseUnits`. It
   * goes out through the screen rather than being written from here, so the
   * write joins every other one on the logging screen in the guard that
   * notices when the disk stops accepting them.
   */
  onChangeUnits: (units: { weightUnit?: WeightUnit; distanceUnit?: DistanceUnit }) => void;
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
/** The unit headings are 11px type in a 62pt cell; the target is the slop. */
const UNIT_SLOP = { top: 10, bottom: 10, left: 4, right: 4 };
const ADD_SET_SLOP = { top: 8, bottom: 8 };

export function ExerciseBlock({
  detail,
  previousSets,
  previousNote,
  progression,
  onAddSet,
  onUpdateSet,
  onToggleSet,
  onDeleteSet,
  onChangeSetType,
  onRemoveExercise,
  onReplaceExercise,
  onReorder,
  onEditNotes,
  onEditRest,
  onChangeUnits,
  onOpenExercise,
}: ExerciseBlockProps) {
  const colors = useColors();
  // This exercise's units, which are the app's until the user says otherwise.
  const { weightUnit, distanceUnit } = useExerciseUnits(detail.exercise);
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

  /*
   * What to lift next, from the sessions behind this one.
   *
   * `suggestForExercise` resolves the load step, the rep range and the tracking
   * type, calls the engine, and swallows anything the engine throws — so this
   * is a suggestion or it is nothing, and the logging screen cannot be taken
   * down by an opinion about a set. The guard and its reasoning live there,
   * next to the call it protects.
   */
  const suggestion = useMemo(
    () => (progression ? suggestForExercise(detail, progression) : null),
    [detail, progression],
  );

  /*
   * The sets the suggestion would fill, and the reason the line is tappable
   * rather than decorative.
   *
   * Open working sets only, and only the ordinals the engine spoke about: a set
   * already checked off is a record and is never rewritten, and a fifth set the
   * engine said nothing about has no target — inventing one is the mistake
   * `pairWithPrevious` refuses to make one column over.
   *
   * In render rather than memoised, because it also decides whether the line
   * appears at all: a block with every set logged has nothing left to fill, and
   * a control that does nothing when pressed is worse than no control.
   */
  const suggestedPatches: { setId: string; patch: Partial<WorkoutSet> }[] = [];

  if (suggestion) {
    const byWorkingIndex = new Map(suggestion.sets.map((entry) => [entry.workingIndex, entry]));

    for (const row of rows) {
      if (row.set.isCompleted || !isWorkingSet(row.set.setType)) continue;

      const entry = byWorkingIndex.get(row.workingIndex);
      if (!entry) continue;

      // Only the fields this exercise tracks, and only the ones the engine put
      // a number in — the same rule `handleCopyPrevious` follows, for the same
      // reason: a blanket patch writes nulls over what is already typed.
      const patch: Partial<WorkoutSet> = {};
      if (fields.weight && entry.weightKg != null) patch.weightKg = entry.weightKg;
      if (fields.reps && entry.reps != null) patch.reps = entry.reps;
      if (Object.keys(patch).length === 0) continue;

      suggestedPatches.push({ setId: row.set.id, patch });
    }
  }

  const suggestionLine =
    suggestion && suggestedPatches.length > 0
      ? describeSuggestion(suggestion, fields, weightUnit)
      : null;

  /**
   * The only way a suggested number reaches a set: an explicit press.
   *
   * Nothing is pre-filled and no placeholder changes. The Previous column and
   * the field placeholders still say what was lifted last time, and a bare
   * check-off still commits exactly that — see `ghostFill`. A heavier weight
   * sitting in a placeholder would be committed by that same tap, and the log
   * would then hold a lift nobody performed.
   */
  const applySuggestion = () => {
    haptics.selection();
    for (const { setId, patch } of suggestedPatches) onUpdateSet(setId, patch);
  };

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
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Remove exercise',
        message: `Remove ${detail.exercise.name} from this workout?`,
        confirmLabel: 'Remove',
      });
      if (confirmed) onRemoveExercise();
    })();
  };

  // Notes moved here when the title became a link to the exercise page, and
  // Replace joined them when substitution stopped meaning "delete and re-add".
  //
  // All four now reach the screen. Under `Alert.alert` only the first three did
  // on Android — `Alert.js` slices the array before mapping it onto the
  // neutral/negative/positive slots — so Cancel, last here, was the button that
  // silently went missing on the platform this app ships to, on a dialog whose
  // scrim was also not dismissible by default. The in-app dialog stacks however
  // many actions it is handed and floats Cancel to the bottom itself, which is
  // where iOS was already putting it regardless of this order. Rest keeps its
  // own chip in the header.
  const openMenu = () => {
    void showDialog({
      title: detail.exercise.name,
      actions: [
        { label: 'Reorder exercises', onPress: onReorder },
        { label: 'Replace exercise', onPress: onReplaceExercise },
        {
          label: detail.workoutExercise.notes ? 'Edit note' : 'Add note',
          onPress: () => onEditNotes(),
        },
        { label: 'Remove exercise', style: 'destructive', onPress: confirmRemove },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
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

      {/* What to lift, and why — under the notes and above the table, which is
          the order the block is read in: what this exercise is, what you told
          yourself about it, what to aim for, then the numbers.

          Tertiary text on the canvas, exactly like the recalled note directly
          above it. Not a card, not accented and not a button that looks like
          one: the accent is budgeted at roughly one element per view
          (`theme/tokens.ts`) and this screen already spends it on the progress
          rule and the rest countdown. A suggestion is the app having an
          opinion, and an opinion should be offered at the volume of a note. */}
      {suggestionLine && (
        <Pressable
          onPress={applySuggestion}
          style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={suggestionLine.label}
          accessibilityHint="Fills these numbers into the sets you have not logged yet"
        >
          <Text variant="label" color="textTertiary" numberOfLines={2}>
            {suggestionLine.text}
          </Text>
        </Pressable>
      )}

      {/* Column headings. `overline` uppercases and adds tracking, so these are
          written in sentence case — the same rule every other heading follows.

          The two that name a unit are also the control for it: see `UnitHeader`.
          Time and Reps are not units the user has an opinion about, so they stay
          plain text and the rule reads as "if the heading is a unit, it is a
          button". */}
      <View style={[styles.columnHeader, { borderBottomColor: colors.border }]}>
        <Text variant="overline" color="textTertiary" style={styles.indexCell}>
          Set
        </Text>
        <Text variant="overline" color="textTertiary" style={styles.previousCell}>
          Previous
        </Text>
        {fields.weight && (
          <UnitHeader
            name="Weight"
            value={weightUnit}
            options={WEIGHT_UNITS}
            onChange={(next) => onChangeUnits({ weightUnit: next })}
          />
        )}
        {fields.duration && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Time
          </Text>
        )}
        {fields.distance && (
          <UnitHeader
            name="Distance"
            value={distanceUnit}
            options={DISTANCE_UNITS}
            onChange={(next) => onChangeUnits({ distanceUnit: next })}
          />
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
          // Handed down rather than read from settings inside the row: the row
          // has to agree with the heading directly above it, and the heading is
          // this exercise's, not the app's.
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
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

/**
 * A column heading that is also the switch for the unit it names.
 *
 * Changing units used to mean leaving the session for Settings, which is four
 * taps and a scroll at the moment you have a dumbbell in one hand and the rack
 * says 55 and your app says kilograms. The heading was already printing the
 * answer — `kg`, `km` — so it becomes the control rather than gaining one: no
 * new row, no sheet, and the affordance is discoverable because the current
 * state is what you tap.
 *
 * A tap cycles rather than opening a picker. Both dimensions have exactly two
 * options, so a picker would be a modal to choose between the thing you can see
 * and the only alternative. That also makes a mis-tap free — every number on
 * screen converts instantly, nothing is written to the sets themselves, and
 * tapping again puts it back.
 *
 * It changes **this exercise's** unit and nothing else's. It used to write the
 * app-wide preference, on the argument that a unit is only a lens over numbers
 * stored in kilograms either way (`packages/shared/src/units.ts`), and that a
 * per-exercise lens would leave "which unit was this row under?" unanswerable.
 * The second half was the real objection and it is gone: the exercise row
 * carries the answer now (`exercises.weight_unit`), so every set under this
 * heading is read in the unit the heading names.
 *
 * The first half was never the user's problem. Switching the dumbbell press to
 * pounds re-labelled the squat, the leg press and every figure on the history
 * screen with it — a whole-app decision taken from a heading that sits above
 * one exercise's four rows. What was meant was "this rack is in pounds".
 */
function UnitHeader<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  /** The dimension, for the screen reader: "Weight", "Distance". */
  name: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
}) {
  const colors = useColors();
  const next = options[(options.indexOf(value) + 1) % options.length] ?? value;

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onChange(next);
      }}
      accessibilityRole="button"
      // Names the dimension, because "kg" alone out of context is not a control
      // anyone can act on — and the hint is what makes it one rather than a
      // heading a screen reader user is left guessing about.
      accessibilityLabel={`${name} unit: ${value}`}
      accessibilityHint={`Switches to ${next}`}
      hitSlop={UNIT_SLOP}
      style={({ pressed }) => [styles.unitCell, styles.unitHeader, pressed && styles.pressed]}
    >
      <Text variant="overline" color="textTertiary">
        {value}
      </Text>
      {/* Nine pixels of glyph, and the whole reason the heading reads as
          tappable. Without it this is indistinguishable from the Time and Reps
          headings beside it, which are not. */}
      <Ionicons name="swap-horizontal" size={9} color={colors.textTertiary} />
    </Pressable>
  );
}

/**
 * One line for a suggestion: the target, then the sentence that justifies it.
 *
 * `Target 82.5 kg × 8 — cleared 12 reps on every set`. The reason is the
 * engine's own words and arrives sentence case with no trailing period, so it
 * is printed as given rather than reworded here — one place decides how the app
 * explains itself.
 *
 * The weight is read in the exercise's unit, never in kilograms, because the
 * whole point of the line is a number the user can walk to the rack and load.
 * The spoken label is built alongside the printed one rather than derived from
 * it, for the reason `describePlates` gives: `×` is read out inconsistently, so
 * a screen reader hears "for 8 reps".
 *
 * Null when the target is empty — an engine that has a kind and a reason but no
 * numbers has nothing to put in front of anyone.
 */
function describeSuggestion(
  suggestion: Suggestion,
  fields: { weight: boolean; reps: boolean },
  unit: WeightUnit,
): { text: string; label: string } | null {
  // The first working set is the target. The engine may taper the ones after
  // it, and a heading that recited four sets would be the table below it.
  const target = suggestion.sets[0];
  if (!target) return null;

  const parts: string[] = [];
  const spoken: string[] = [];

  if (fields.weight && target.weightKg != null) {
    parts.push(formatWeight(target.weightKg, unit));
    spoken.push(formatWeight(target.weightKg, unit));
  }
  if (fields.reps && target.reps != null) {
    parts.push(parts.length > 0 ? `× ${target.reps}` : `${target.reps} reps`);
    spoken.push(spoken.length > 0 ? `for ${target.reps} reps` : `${target.reps} reps`);
  }

  if (parts.length === 0) return null;

  return {
    text: `Target ${parts.join(' ')} — ${suggestion.reason}`,
    label: `Suggested target, ${spoken.join(' ')}. ${suggestion.reason}`,
  };
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
  // The same box as a note, because it reads as one: a quiet line on the canvas
  // between the heading and the table.
  suggestion: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  /*
   * One rule, under the headings only.
   *
   * `StatBand` had its rules taken away on the argument that figures in columns
   * under uppercase labels already read as a table without being boxed in, and
   * that is right — for two or three figures on one line. This is a real table:
   * five columns and up to a dozen rows, with editable fields in it. The
   * headings were floating a few points above the first row with nothing to
   * attach them to, so at a glance the top set row read as the heading's
   * content rather than as the first record under it.
   *
   * A rule under the headings is not the grid that was removed. There is
   * nothing between the columns, nothing under the rows and nothing around the
   * outside — the one line says where the header stops, which is the single
   * thing the eye was missing.
   */
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: stroke.rule,
  },
  indexCell: { width: 32, textAlign: 'center' },
  previousCell: { flex: 1, minWidth: 60 },
  unitCell: { width: 62, textAlign: 'center' },
  // The plain headings are `Text` and centre themselves; a `UnitHeader` is a row
  // of two things, so it has to say so. 2pt rather than a spacing token — the
  // glyph is an annotation on the word, not a second item beside it.
  unitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
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
