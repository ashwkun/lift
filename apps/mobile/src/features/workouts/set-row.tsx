import { Ionicons } from '@expo/vector-icons';
import {
  formatDistance,
  formatDuration,
  formatWeight,
  fromDisplayDistance,
  fromDisplayWeight,
  parseDuration,
  toDisplayDistance,
  SET_TYPE_BADGE,
  SET_TYPE_LABELS,
  TRACKING_FIELDS,
  trimZeros,
  type DistanceUnit,
  type SetType,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { NumericField, Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { canLogSet } from '@/features/workouts/repository';
import { showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

export interface SetRowProps {
  set: WorkoutSet;
  /** 1-based index among working sets; warm-ups show a badge instead. */
  workingIndex: number;
  trackingType: TrackingType;
  /** Same-position set from the previous session, shown as a ghost target. */
  previous?: WorkoutSet;
  onChange: (patch: Partial<WorkoutSet>) => void;
  /**
   * Resolves `false` when the write was refused or lost, so the row can take
   * its optimistic check back down. A caller with nothing to report may return
   * nothing, and the row then keeps the state the press asserted.
   */
  onToggleComplete: () => void | Promise<boolean>;
  onDelete: () => void;
  onChangeSetType: (setType: SetType) => void;
}

/** Formats the "previous" column, e.g. "100 kg × 5" or "—". */
function formatPrevious(
  previous: WorkoutSet | undefined,
  trackingType: TrackingType,
  unit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  if (!previous) return '—';

  const fields = TRACKING_FIELDS[trackingType];
  const parts: string[] = [];

  if (fields.weight && previous.weightKg != null) {
    parts.push(formatWeight(previous.weightKg, unit));
  }
  if (fields.duration && previous.durationSeconds != null) {
    parts.push(formatDuration(previous.durationSeconds));
  }
  if (fields.distance && previous.distanceKm != null) {
    parts.push(formatDistance(previous.distanceKm, distanceUnit));
  }
  if (fields.reps && previous.reps != null) {
    parts.push(parts.length > 0 ? `× ${previous.reps}` : `${previous.reps} reps`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * How a stored distance is spelled back into its field.
 *
 * Two decimals and trimmed zeros, for the same reason `formatWeight` uses them
 * on the weight field: the value now makes a unit round trip on every keystroke,
 * and that leaves float noise — a mile-entered 3 comes back as 2.999999999999
 * — while an untrimmed "3.00" would reappear in the field as characters the
 * user has to delete before typing.
 */
function asDistanceField(km: number, unit: DistanceUnit): string {
  return trimZeros(toDisplayDistance(km, unit).toFixed(2));
}

/**
 * How a typed time comes back out of storage, for the duration field's own
 * echo check. Nothing else in a set row needs one: a weight, a rep count and a
 * distance render back as they were typed — the two that convert do so through
 * a formatter that absorbs the round trip — but seconds are always re-spelled
 * as M:SS, so "4" returns as "0:04". Module scope so every row shares the one
 * function and the field is not handed a new prop on each render.
 *
 * An unparseable string maps to '' to agree with `handleDurationChange`, which
 * writes null only for the empty string.
 */
const normalizeDuration = (text: string) => {
  const seconds = parseDuration(text);
  return seconds == null ? '' : formatDuration(seconds);
};

/**
 * Motion for the check-off, which is the gesture this app exists to perform.
 *
 * Everything here is driven by shared values rather than React state, so the
 * animation runs on the UI thread and never contends with the set row's
 * controlled text inputs — the row can be mid-transition while a weight is
 * being typed and neither notices the other. `ReduceMotion.System` is passed on
 * each config rather than checked once in JS, so the OS setting is honoured
 * without a re-render to observe it.
 */
const TINT = {
  duration: 170,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};

const SQUASH = {
  duration: 90,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};

const RELEASE = {
  damping: 11,
  stiffness: 340,
  mass: 0.5,
  reduceMotion: ReduceMotion.System,
};

/**
 * Asymmetric on purpose, and not the shared `HIT_SLOP` token.
 *
 * Rows are 44 tall with 4pt of vertical padding, so the 30pt check plates of
 * two stacked rows sit 14pt apart: a symmetric 8pt slop overlaps by 2pt, and
 * iOS hit-tests siblings in reverse order, which hands that overlap to the
 * *lower* row — a near-miss would complete the wrong set and start its rest
 * timer. 7 tiles the gap exactly and still reaches the 44pt minimum. The left
 * edge stays inside the row's 8pt column gap because this Pressable is the last
 * child and would win any overlap against the reps field beside it. Only the
 * right edge, which faces the screen margin, is free to be generous.
 */
const CHECK_HIT_SLOP = { top: 7, bottom: 7, left: 6, right: spacing.lg };

/**
 * Mirrors CHECK_HIT_SLOP at the other end of the row.
 *
 * `alignSelf: 'stretch'` only reaches 36pt — `minHeight: 44` is border-box and
 * the row carries 4pt of vertical padding — so 4pt of slop tiles the remainder
 * exactly: 44pt of target inside a 44pt row, with no overlap for the row below
 * to steal. The left edge faces the row's 16pt margin, which holds nothing
 * pressable, so it can be generous. The right edge stays at 0, because the
 * previous-set cell is the next sibling and would win any overlap anyway.
 */
const INDEX_HIT_SLOP = { top: 4, bottom: 4, left: spacing.lg, right: 0 };

/**
 * Deleting a set is a swipe, and a screen reader cannot swipe. The action hangs
 * off the two controls a user lands on when they reach the row.
 */
const DELETE_ACTIONS = [{ name: 'delete', label: 'Delete set' }];

export const SetRow = memo(function SetRow({
  set,
  workingIndex,
  trackingType,
  previous,
  onChange,
  onToggleComplete,
  onDelete,
  onChangeSetType,
}: SetRowProps) {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);
  const distanceUnit = useSettings((state) => state.distanceUnit);

  // 0 = open, 1 = checked off. Seeded from the current value so a screen opened
  // on a half-finished workout renders its state rather than animating into it.
  const done = useSharedValue(set.isCompleted ? 1 : 0);
  const pop = useSharedValue(1);
  const settled = useRef(false);

  // What the last press asserted, held until the row agrees. The check-off is
  // driven by the press rather than by the write it starts: that write is four
  // SQLite statements and a live-query re-emit away, and a plate that waits for
  // them reads as a dropped tap on the one control this app exists to press.
  // The latch is what keeps the reconcile effect below from animating a second
  // time when its own echo arrives.
  const pending = useRef<boolean | null>(null);

  useEffect(() => {
    if (pending.current !== null) {
      if (pending.current === set.isCompleted) pending.current = null;
      return;
    }

    done.value = withTiming(set.isCompleted ? 1 : 0, TINT);

    // The squash-and-release belongs to the tap, so it is skipped on the first
    // pass — otherwise every already-completed row bounces when the screen opens.
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (!set.isCompleted) return;

    pop.value = withSequence(withTiming(0.85, SQUASH), withSpring(1, RELEASE));
  }, [set.isCompleted, done, pop]);

  // A tint layer rather than an animated `backgroundColor`: interpolating out of
  // `transparent` runs through rgba(0,0,0,0) and greys the row on the way past.
  const tintStyle = useAnimatedStyle(() => ({ opacity: done.value }));
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: done.value }));
  const idleGlyphStyle = useAnimatedStyle(() => ({ opacity: 1 - done.value }));
  const doneGlyphStyle = useAnimatedStyle(() => ({ opacity: done.value }));

  const fields = TRACKING_FIELDS[trackingType];
  const badge = SET_TYPE_BADGE[set.setType];

  // How the row names itself to a screen reader. Warm-ups are left out of the
  // working-set count on purpose, so they answer with their type rather than
  // borrowing the ordinal of the set that follows them.
  const setName =
    set.setType === 'warmup'
      ? SET_TYPE_LABELS.warmup
      : set.setType === 'normal'
        ? `Set ${workingIndex}`
        : `Set ${workingIndex}, ${SET_TYPE_LABELS[set.setType]}`;

  const badgeColor =
    set.setType === 'warmup'
      ? colors.warning
      : set.setType === 'drop'
        ? colors.accent
        : set.setType === 'failure'
          ? colors.danger
          : colors.textSecondary;

  const handleWeightChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      // Inputs are in the user's display unit; storage is always kilograms.
      onChange({ weightKg: parsed === null ? null : fromDisplayWeight(parsed, weightUnit) });
    },
    [onChange, weightUnit],
  );

  const handleRepsChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number.parseInt(text, 10);
      if (parsed !== null && !Number.isFinite(parsed)) return;
      onChange({ reps: parsed });
    },
    [onChange],
  );

  const handleDurationChange = useCallback(
    (text: string) => {
      if (text === '') {
        onChange({ durationSeconds: null });
        return;
      }
      // A stray "." or a fourth colon is a keystroke on the way somewhere, not
      // an instruction to forget the time that is already logged.
      const parsed = parseDuration(text);
      if (parsed == null) return;
      onChange({ durationSeconds: parsed });
    },
    [onChange],
  );

  const handleDistanceChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      // Same rule as the weight field, and it was missing here: the field is in
      // the user's display unit and storage is always kilometres. Without the
      // conversion a user set to miles typed "3", stored 3 *kilometres*, and
      // then read it back as 1.86 mi on the records screen — which does convert.
      // The set row was the only place in the app that treated the two as the
      // same number.
      onChange({
        distanceKm: parsed === null ? null : fromDisplayDistance(parsed, distanceUnit),
      });
    },
    [onChange, distanceUnit],
  );

  const handleCopyPrevious = useCallback(() => {
    if (!previous) return;

    // Only fields this exercise tracks, and only the ones last session actually
    // holds a number for. A blanket copy writes the previous row's nulls over
    // whatever is already typed here — so tapping this cell for the reps would
    // silently erase the weight you had just entered.
    const patch: Partial<WorkoutSet> = {};
    if (fields.weight && previous.weightKg != null) patch.weightKg = previous.weightKg;
    if (fields.reps && previous.reps != null) patch.reps = previous.reps;
    if (fields.duration && previous.durationSeconds != null) {
      patch.durationSeconds = previous.durationSeconds;
    }
    if (fields.distance && previous.distanceKm != null) patch.distanceKm = previous.distanceKm;
    if (Object.keys(patch).length === 0) return;

    haptics.selection();
    onChange(patch);
  }, [previous, fields, onChange]);

  // A set with nothing in the field it is measured by has nothing to log, and
  // the screen refuses to complete it. Both sides ask the same function rather
  // than each restating the rule, so the press only asserts a state the write
  // can actually reach. The previous session counts, because the screen folds
  // those numbers into the write. Should the two ever part company again, a
  // refused write now reports it and the plate goes back down.
  const loggable = canLogSet(fields, set, previous);

  const handleToggle = useCallback(() => {
    const next = !set.isCompleted;
    const latched = !next || loggable;

    if (latched) {
      pending.current = next;
      done.value = withTiming(next ? 1 : 0, TINT);
      if (next) pop.value = withSequence(withTiming(0.85, SQUASH), withSpring(1, RELEASE));
    }

    // A write that never landed leaves the latch asserting a state the database
    // does not hold, and the row would sit green under the screen's own "not
    // saving" banner until it was unmounted. `false` is the only answer that
    // unwinds it: a caller that reports nothing keeps the old behaviour.
    void Promise.resolve(onToggleComplete()).then((ok) => {
      // Only ever unwind our own latch. A press that arrived while this write
      // was in flight owns `pending` now, and its assertion has to stand.
      if (ok !== false || !latched || pending.current !== next) return;
      pending.current = null;
      done.value = withTiming(set.isCompleted ? 1 : 0, TINT);
    });
  }, [set.isCompleted, loggable, done, pop, onToggleComplete]);

  const confirmDelete = useCallback(() => {
    void (async () => {
      if (await showConfirm({ title: 'Delete set', confirmLabel: 'Delete' })) onDelete();
    })();
  }, [onDelete]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'delete') confirmDelete();
    },
    [confirmDelete],
  );

  const weightValue =
    set.weightKg == null ? '' : formatWeight(set.weightKg, weightUnit, { withUnit: false });
  const distanceValue = set.distanceKm == null ? '' : asDistanceField(set.distanceKm, distanceUnit);

  return (
    <Animated.View
      // Added and swiped-away sets fade rather than pop in and out of the list.
      entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(110).reduceMotion(ReduceMotion.System)}
    >
      <ReanimatedSwipeable
        friction={2}
        rightThreshold={40}
        renderRightActions={() => (
          <Pressable
            onPress={onDelete}
            accessibilityLabel="Delete set"
            // Hidden from the accessibility tree: this button only exists once
            // a swipe has revealed it, but it is mounted the whole time, so a
            // screen reader announced a delete for every set on the screen.
            // Without the gesture, delete arrives through the `accessibilityActions`
            // on the set number and the check plate instead.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.deleteAction, { backgroundColor: colors.danger }]}
          >
            <Ionicons name="trash" size={20} color={colors.textOnDanger} />
          </Pressable>
        )}
      >
        <View style={styles.row}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, tintStyle, { backgroundColor: colors.accentSurface }]}
          />

          {/* Set number / type badge */}
          <Pressable
            onPress={() => onChangeSetType(nextSetType(set.setType))}
            onLongPress={confirmDelete}
            hitSlop={INDEX_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={setName}
            accessibilityHint="Changes the set type"
            accessibilityActions={DELETE_ACTIONS}
            onAccessibilityAction={handleAccessibilityAction}
            style={styles.indexCell}
          >
            <Text variant="numeric" style={{ color: badgeColor }}>
              {badge ?? workingIndex}
            </Text>
          </Pressable>

          {/* Previous session. One brightness step and one glyph, not a chip:
              five hairline boxes per exercise would clutter the column whose
              whole job is to sit quietly beside the numbers being typed. */}
          <Pressable
            style={({ pressed }) => [
              styles.previousCell,
              // `surfacePressed`, not `accentSurface` — the accent tint already
              // means "checked off" one row width away.
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={!previous}
            onPress={handleCopyPrevious}
            accessibilityRole="button"
            accessibilityLabel={
              previous
                ? `Previous, ${formatPrevious(previous, trackingType, weightUnit, distanceUnit)}`
                : 'No previous set'
            }
            accessibilityHint={previous ? 'Copies these numbers into this set' : undefined}
          >
            <Text
              variant="label"
              color={previous ? 'textSecondary' : 'textTertiary'}
              numberOfLines={1}
              style={styles.previousText}
            >
              {formatPrevious(previous, trackingType, weightUnit, distanceUnit)}
            </Text>
            {previous && (
              <Ionicons name="return-down-forward" size={11} color={colors.textTertiary} />
            )}
          </Pressable>

          {fields.weight && (
            <NumericField
              value={weightValue}
              onChangeText={handleWeightChange}
              accessibilityLabel={`${setName}, weight in ${weightUnit}`}
              placeholder={
                previous?.weightKg != null
                  ? formatWeight(previous.weightKg, weightUnit, { withUnit: false })
                  : '0'
              }
              style={styles.input}
            />
          )}

          {fields.duration && (
            <NumericField
              value={set.durationSeconds == null ? '' : formatDuration(set.durationSeconds)}
              onChangeText={handleDurationChange}
              normalize={normalizeDuration}
              accessibilityLabel={`${setName}, time`}
              keyboardType="numbers-and-punctuation"
              placeholder={
                previous?.durationSeconds != null
                  ? formatDuration(previous.durationSeconds)
                  : '0:00'
              }
              style={styles.input}
            />
          )}

          {fields.distance && (
            <NumericField
              value={distanceValue}
              onChangeText={handleDistanceChange}
              accessibilityLabel={`${setName}, distance in ${distanceUnit}`}
              placeholder={
                previous?.distanceKm != null
                  ? asDistanceField(previous.distanceKm, distanceUnit)
                  : '0'
              }
              style={styles.input}
            />
          )}

          {fields.reps && (
            <NumericField
              value={set.reps == null ? '' : String(set.reps)}
              onChangeText={handleRepsChange}
              accessibilityLabel={`${setName}, reps`}
              keyboardType="number-pad"
              placeholder={previous?.reps != null ? String(previous.reps) : '0'}
              style={styles.input}
            />
          )}

          <Pressable
            onPress={handleToggle}
            hitSlop={CHECK_HIT_SLOP}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: set.isCompleted }}
            accessibilityLabel={`Complete ${setName}`}
            accessibilityActions={DELETE_ACTIONS}
            onAccessibilityAction={handleAccessibilityAction}
          >
            <Animated.View
              style={[styles.checkCell, { backgroundColor: colors.surfaceMuted }, checkStyle]}
            >
              {/* The green fills in over the resting grey, and the two glyphs
                  cross-fade above it — a single glyph would have to swap colour
                  on one frame while the plate underneath was still arriving. */}
              <Animated.View
                style={[StyleSheet.absoluteFill, fillStyle, { backgroundColor: colors.success }]}
              />
              <Animated.View style={[styles.glyph, idleGlyphStyle]}>
                <Ionicons name="checkmark" size={18} color={colors.textTertiary} />
              </Animated.View>
              <Animated.View style={[styles.glyph, doneGlyphStyle]}>
                <Ionicons name="checkmark" size={18} color={colors.textOnSuccess} />
              </Animated.View>
            </Animated.View>
          </Pressable>
        </View>
      </ReanimatedSwipeable>
    </Animated.View>
  );
});

/** Cycles set type on tap: normal → warm-up → drop → failure → normal. */
function nextSetType(current: SetType): SetType {
  const order: SetType[] = ['normal', 'warmup', 'drop', 'failure'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length]!;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  // Stretched to the row's content box so the tap target is the height of the
  // row rather than of the one glyph inside it. Visually identical: the row
  // centres its children anyway.
  indexCell: {
    width: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stretched rather than centred so the pressed fill covers the whole cell,
  // and with no padding of its own so the text stays under its column heading.
  previousCell: {
    flex: 1,
    minWidth: 60,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 3,
    borderRadius: radius.sm,
  },
  // Shrinks before the copy glyph does, so a long previous set truncates rather
  // than pushing the affordance out of the cell.
  previousText: { flexShrink: 1 },
  input: { flex: 0 },
  checkCell: {
    width: 38,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps the success fill inside the rounded plate.
    overflow: 'hidden',
  },
  glyph: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAction: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
