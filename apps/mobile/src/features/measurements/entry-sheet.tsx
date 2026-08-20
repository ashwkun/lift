import {
  MEASUREMENT_KIND_LABELS,
  formatMeasurementDelta,
  formatMeasurementValue,
  fromDisplayMeasurementValue,
  isPlausibleMeasurement,
  measurementRange,
  measurementStep,
  measurementUnitLabel,
  toDisplayMeasurementValue,
  trimZeros,
  type MeasurementKind,
} from '@lift/shared';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type AccessibilityActionEvent,
} from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import type { BodyMeasurement } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { useSettings } from '@/store/settings';
import { font, fontSize, MIN_TOUCH_SIZE, radius, spacing, useColors } from '@/theme';

/** Hoisted so the stepper's props keep their identity between renders. */
const STEPPER_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

/** How far back the date stepper will walk. Beyond this, it is a new reading. */
const MAX_BACKDATE_DAYS = 365;

export interface MeasurementEntryInput {
  /** Storage units — kg, percent or cm. */
  value: number;
  measuredAt: Date;
  notes: string | null;
}

export interface MeasurementEntrySheetProps {
  visible: boolean;
  kind: MeasurementKind | null;
  /** Supplied when correcting a reading already filed rather than adding one. */
  entry?: BodyMeasurement | null;
  /** The newest reading before this one, for the change preview. */
  previous?: BodyMeasurement | null;
  /**
   * Position in a guided run through several kinds. Turns Save into Next and
   * puts a Skip beside it, so a measuring session is one sheet rather than one
   * sheet per body part.
   */
  progress?: { index: number; total: number } | null;
  onCancel: () => void;
  onSubmit: (input: MeasurementEntryInput) => void;
  onDelete?: () => void;
  onSkip?: () => void;
}

/**
 * Files one measurement.
 *
 * This replaces a bare text prompt, which could do exactly one thing: attach a
 * number to the instant the dialog was open. Everything it could not do was
 * something people actually need — weighing in at 7am and logging it at 9pm,
 * fixing a tape read wrong, noting that this one was taken after a heavy meal,
 * or nudging a figure by a tenth without retyping it. It also accepted any
 * number at all, so a waist of 850 cm went into the log and flattened every
 * chart it appeared on.
 */
export function MeasurementEntrySheet({
  visible,
  kind,
  entry = null,
  previous = null,
  progress = null,
  onCancel,
  onSubmit,
  onDelete,
  onSkip,
}: MeasurementEntrySheetProps) {
  const colors = useColors();

  // Two primitive selectors rather than one returning an object: Zustand hands
  // the selector's result to `useSyncExternalStore`, which re-renders whenever
  // the snapshot's identity changes — a fresh object every render is an
  // infinite loop.
  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);
  const prefs = useMemo(() => ({ weightUnit, measurementUnit }), [weightUnit, measurementUnit]);

  const [draft, setDraft] = useState('');
  const [measuredAt, setMeasuredAt] = useState(() => new Date());
  const [notes, setNotes] = useState('');

  // Re-seeded whenever the sheet opens on a different subject, adjusted during
  // render against what it was last seeded from — the pattern the other sheets
  // in this app use. An effect would do the same job one commit later, painting
  // the previous body part's number for a frame first.
  const [seed, setSeed] = useState({ visible, kind, entryId: entry?.id ?? null });

  if (seed.visible !== visible || seed.kind !== kind || seed.entryId !== (entry?.id ?? null)) {
    setSeed({ visible, kind, entryId: entry?.id ?? null });

    if (visible && kind) {
      // Editing starts from the reading being corrected; a new entry starts
      // from the last one, because the next measurement of a thigh is almost
      // always within a centimetre of the last and retyping it in full is
      // work the app can do. The field selects on focus, so replacing it
      // outright costs nothing either.
      const source = entry ?? previous;
      setDraft(
        source ? trimZeros(toDisplayMeasurementValue(kind, source.value, prefs).toFixed(1)) : '',
      );
      setMeasuredAt(entry ? new Date(entry.measuredAt) : new Date());
      setNotes(entry?.notes ?? '');
    }
  }

  // The parent drops `kind` at the same moment it hides the sheet, and a
  // component that returns null is torn out of the tree rather than animated
  // out of it — so the fade never played. Holding the last subject lets the
  // dismissal finish on the content it was already showing.
  const [lastKind, setLastKind] = useState(kind);
  if (kind && kind !== lastKind) setLastKind(kind);

  const subject = kind ?? lastKind;
  if (!subject) return null;

  const label = MEASUREMENT_KIND_LABELS[subject];
  const unit = measurementUnitLabel(subject, prefs);
  const step = measurementStep(subject, prefs);

  const parsed = parseDecimal(draft);
  const stored = parsed === null ? null : fromDisplayMeasurementValue(subject, parsed, prefs);
  const valid = stored !== null && isPlausibleMeasurement(subject, stored);

  // Only complains about a number that has actually been typed. An empty field
  // is a sheet that just opened, not a mistake.
  const range = measurementRange(subject, prefs);
  const error =
    draft.trim().length > 0 && !valid
      ? `Enter a ${label.toLowerCase()} between ${trimZeros(range.min.toFixed(1))} and ${trimZeros(
          range.max.toFixed(1),
        )} ${unit}.`
      : null;

  // The reason to seed the field from the last reading is also the reason to
  // show what it was: the useful thing about a measurement is the gap between
  // it and the one before.
  const comparison = entry ? null : previous;
  const change =
    comparison && stored !== null && valid ? stored - comparison.value : null;

  const adjust = (direction: 1 | -1) => {
    const from =
      parsed ?? (comparison ? toDisplayMeasurementValue(subject, comparison.value, prefs) : 0);
    // Snapped to the grid the step defines rather than added blindly, so a
    // value inherited from a differently-rounded source lands back on it.
    const next =
      direction > 0
        ? (Math.floor(round(from / step)) + 1) * step
        : (Math.ceil(round(from / step)) - 1) * step;

    if (next <= 0) return;
    haptics.selection();
    setDraft(trimZeros(next.toFixed(2)));
  };

  const onStepperAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') adjust(1);
    if (event.nativeEvent.actionName === 'decrement') adjust(-1);
  };

  const shiftDay = (days: number) => {
    const next = new Date(measuredAt);
    next.setDate(next.getDate() + days);
    if (startOfDay(next) > startOfDay(new Date())) return;
    if (daysAgo(next) > MAX_BACKDATE_DAYS) return;

    haptics.selection();
    setMeasuredAt(next);
  };

  const submit = () => {
    if (stored === null || !valid) return;
    onSubmit({ value: stored, measuredAt: atMeasuringTime(measuredAt), notes: notes.trim() || null });
  };

  const isToday = daysAgo(measuredAt) === 0;
  const confirmLabel = entry ? 'Save' : progress ? 'Next' : 'Log';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/*
          `accessible={false}` on both Pressables. Pressable defaults to
          accessible, which would collapse the whole sheet into one element and
          leave the field, the stepper and both buttons unreachable — the same
          trap the rest-duration sheet documents. Tap-outside-to-dismiss has no
          screen reader equivalent on purpose: Cancel is a swipe away, and
          Android's back gesture already routes to `onRequestClose`.
        */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onCancel}
        >
          <Pressable
            accessible={false}
            accessibilityViewIsModal
            style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
            onPress={(event) => event.stopPropagation()}
          >
            <ScrollView
              // The sheet is short on a phone and tall once the keyboard, an
              // error line and a note field are all up at once. Taps pass
              // through to the buttons rather than being eaten as scroll
              // starts, which is what `handled` buys.
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              <View style={styles.heading}>
                <Text variant="subheading" accessibilityRole="header">
                  {label}
                </Text>
                <Text variant="label" color="textSecondary">
                  {progress
                    ? `${progress.index + 1} of ${progress.total} · in ${unit}`
                    : `Entered in ${unit}`}
                </Text>
              </View>

              {/*
                One adjustable control rather than three elements. A screen
                reader reading "minus button, 82.4, plus button" makes the user
                hunt for the step; `adjustable` puts it on the swipe gesture the
                platform already reserves for exactly this.
              */}
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={label}
                accessibilityValue={{ text: parsed === null ? 'Not set' : `${draft} ${unit}` }}
                accessibilityActions={STEPPER_ACTIONS}
                onAccessibilityAction={onStepperAction}
                style={[styles.stepper, { backgroundColor: colors.surfaceMuted }]}
              >
                <StepperButton
                  label={`Subtract ${trimZeros(step.toFixed(2))} ${unit}`}
                  glyph="−"
                  onPress={() => adjust(-1)}
                />

                <View style={styles.valueRow}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    keyboardType="decimal-pad"
                    autoFocus
                    selectTextOnFocus
                    placeholder="0.0"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={6}
                    // Hidden from the screen reader: the adjustable wrapper
                    // above already announces the same value, and reaching the
                    // raw field would announce it twice with two different
                    // roles.
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[styles.valueField, { color: colors.text }]}
                    onSubmitEditing={submit}
                    returnKeyType="done"
                  />
                  <Text variant="subheading" color="textTertiary">
                    {unit}
                  </Text>
                </View>

                <StepperButton
                  label={`Add ${trimZeros(step.toFixed(2))} ${unit}`}
                  glyph="+"
                  onPress={() => adjust(1)}
                />
              </View>

              {error ? (
                <Text variant="caption" color="danger">
                  {error}
                </Text>
              ) : change !== null && comparison ? (
                <Text variant="caption" color="textTertiary">
                  {`${formatMeasurementDelta(subject, change, prefs)} since ${shortDate(
                    comparison.measuredAt,
                  )} · was ${formatMeasurementValue(subject, comparison.value, prefs)}`}
                </Text>
              ) : comparison ? (
                <Text variant="caption" color="textTertiary">
                  {`Last: ${formatMeasurementValue(subject, comparison.value, prefs)} on ${shortDate(
                    comparison.measuredAt,
                  )}`}
                </Text>
              ) : (
                <Text variant="caption" color="textTertiary">
                  First reading for this measurement.
                </Text>
              )}

              {/*
                A measurement is taken at a moment and logged at another. Weighing
                in before breakfast and remembering to type it at bedtime used to
                file the reading twelve hours late, which is invisible on a chart
                until two entries land on the same day and one of them is wrong.
              */}
              <View style={[styles.dateRow, { backgroundColor: colors.surfaceMuted }]}>
                <StepperButton
                  label="Previous day"
                  glyph="‹"
                  onPress={() => shiftDay(-1)}
                  disabled={daysAgo(measuredAt) >= MAX_BACKDATE_DAYS}
                />
                <Pressable
                  onPress={() => setMeasuredAt(new Date())}
                  disabled={isToday}
                  accessibilityRole="button"
                  accessibilityLabel={`Measured ${describeDay(measuredAt)}`}
                  accessibilityHint={isToday ? undefined : 'Moves this reading back to today.'}
                  style={styles.dateLabel}
                >
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {describeDay(measuredAt)}
                  </Text>
                </Pressable>
                <StepperButton
                  label="Next day"
                  glyph="›"
                  onPress={() => shiftDay(1)}
                  disabled={isToday}
                />
              </View>

              <TextField
                value={notes}
                onChangeText={setNotes}
                placeholder="Note (optional)"
                accessibilityLabel={`Note for this ${label.toLowerCase()} reading`}
                maxLength={140}
                returnKeyType="done"
              />

              <View style={styles.actions}>
                <Button
                  title={progress && onSkip ? 'Skip' : 'Cancel'}
                  variant="ghost"
                  accessibilityLabel={
                    progress && onSkip ? `Skip ${label}` : `Cancel, ${label} unchanged`
                  }
                  onPress={progress && onSkip ? onSkip : onCancel}
                  style={styles.action}
                />
                <Button
                  title={confirmLabel}
                  accessibilityLabel={`${confirmLabel} ${label}`}
                  disabled={!valid}
                  onPress={submit}
                  style={styles.action}
                />
              </View>

              {onDelete && entry && (
                <Button
                  title="Delete this reading"
                  variant="ghost"
                  size="sm"
                  fullWidth
                  accessibilityLabel={`Delete the ${label.toLowerCase()} reading from ${shortDate(
                    entry.measuredAt,
                  )}`}
                  // The one control here under 44pt, and the only one with room
                  // to borrow: it spans the card, and below it is the card's own
                  // padding. Weighted downwards so it can never steal a press
                  // from Save.
                  hitSlop={DELETE_HIT_SLOP}
                  onPress={onDelete}
                  style={styles.delete}
                />
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StepperButton({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.stepperButton,
        { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
        disabled && styles.disabled,
      ]}
    >
      <Text variant="subheading" color="textSecondary">
        {glyph}
      </Text>
    </Pressable>
  );
}

const DELETE_HIT_SLOP = { top: 4, bottom: 12 } as const;

/** "82,4" and "82.4" are the same number; a decimal-pad emits either by locale. */
function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return null;

  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Kills the float dust that makes `82.30000000000001 / 0.1` floor one short. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function daysAgo(date: Date): number {
  return Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
}

/**
 * Where on the chosen day the reading lands.
 *
 * Today keeps the clock, because that is genuinely when it was taken. Any other
 * day gets midday: a backdated entry has no known time, and midnight would put
 * it on the boundary where a timezone shift or a daylight-saving jump can move
 * it to the day before.
 */
function atMeasuringTime(day: Date): Date {
  if (daysAgo(day) === 0) return new Date();

  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}

function describeDay(date: Date): string {
  const ago = daysAgo(date);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return shortDate(date);
}

function shortDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === new Date().getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };

  return date.toLocaleDateString(undefined, options);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    // Capped so a large accessibility text size cannot push the buttons off the
    // bottom of the screen; the ScrollView inside takes over at that point.
    maxHeight: '90%',
    borderRadius: radius.lg,
  },
  content: { padding: spacing.xl, gap: spacing.md },
  heading: { gap: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  // Past the touch minimum in both axes on its own frame. The buttons sit close
  // enough to their neighbours that slop is not available to either: it would
  // overlap, and the later sibling silently wins the hit test.
  stepperButton: {
    width: 52,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  disabled: { opacity: 0.3 },
  valueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  valueField: {
    minWidth: 96,
    textAlign: 'right',
    fontSize: fontSize.xxxl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    // Matches `numericLarge`. See the tracking note in `ui/text.tsx`.
    letterSpacing: -0.4,
    // Android reserves extra room above the ascender and below the descender
    // from the font's own metrics, which at this size pushes the digits off the
    // baseline the unit beside them sits on. Harmless on iOS, which ignores it.
    paddingVertical: 0,
    includeFontPadding: false,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  dateLabel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_SIZE,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
  delete: { marginTop: -spacing.xs },
});
