/**
 * A time of day, typed or stepped.
 *
 * ## What this used to be, and why it is not that any more
 *
 * Two scroll-snapping wheels, iOS-datepicker style: a `ScrollView` per column
 * with `snapToInterval`, reporting the row under a highlight band. It reads
 * beautifully in a screenshot and it did not work. Both reminder screens got
 * the same report, that the wheel will not slide, and a snap wheel has a long
 * list of ways to arrive there that all look identical from outside: it sits
 * inside a `Modal`, which on Android is its own native window outside the
 * gesture root; it re-rendered sixty rows per scroll frame to move the
 * highlight; and it competes for the touch with two nested `Pressable`s, the
 * backdrop and the card. Each of those is separately plausible, none is
 * verifiable from here, and a fix for the wrong one ships a control that still
 * does not slide.
 *
 * So the gesture is gone rather than repaired. What replaces it is the stepper
 * from `features/measurements/entry-sheet`: two buttons and a field, the same
 * control this app already uses for every other number that is nudged more
 * often than it is retyped. It cannot fail to scroll, because it does not
 * scroll. Typing 7 and 30 is two taps and two keystrokes against a flick that
 * has to land on the right of sixty rows.
 *
 * The wheel is not worth another attempt. If a native picker is ever wanted,
 * `@react-native-community/datetimepicker` is the thing to reach for, and the
 * costs are the ones the old header listed: another module in the prebuild,
 * nothing in Expo Go or the browser, and two platform renderings that look like
 * neither each other nor this app.
 *
 * ## The clock it offers
 *
 * Follows the device. `prefersTwelveHourClock` decides whether the hour field
 * runs 1 to 12 with an AM/PM control beside it, or 0 through 23 with none. The
 * value crossing the boundary is always 24-hour `"HH:mm"`; the 12-hour split
 * exists only inside this file.
 */

import {
  parseClockTime,
  prefersTwelveHourClock,
  toClockTime,
  type ClockTime,
} from '@lift/shared';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';

import { haptics } from '@/features/feedback/haptics';
import { font, fontSize, radius, spacing, useColors } from '@/theme';

import { Button } from './button';
import { SegmentedControl } from './segmented-control';
import { Text } from './text';

const DAY_MINUTES = 24 * 60;

/**
 * How far one press of the minute stepper moves.
 *
 * Five, not one. The only two things this dialog sets are "remind me to lift"
 * and "remind me to weigh in", and nobody has ever wanted either at 17:23.
 * Twelve presses cover the hour, where sixty would make the button useless and
 * push everyone into the keyboard. Any minute is still reachable by typing it,
 * which is the point of the field between the buttons.
 */
const MINUTE_STEP = 5;

/** Falls back to 5pm, the same default the store ships. */
const FALLBACK: ClockTime = { hour: 17, minute: 0 };

const MERIDIEM_OPTIONS = [
  { value: 'am' as const, label: 'AM' },
  { value: 'pm' as const, label: 'PM' },
];

/**
 * What a screen reader gets instead of the two buttons.
 *
 * The field is one `adjustable` element, exactly as the measurement stepper is:
 * announcing "minus button, 30, plus button" makes the user hunt for the step,
 * where `adjustable` puts it on the swipe gesture the platform already reserves
 * for this.
 */
const ADJUST_ACTIONS: readonly AccessibilityActionInfo[] = [
  { name: 'increment', label: 'Later' },
  { name: 'decrement', label: 'Earlier' },
];

/** Hoisted so the field's props keep their identity between renders. */
const STEPPER_ACTIONS = ADJUST_ACTIONS as AccessibilityActionInfo[];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Moves a time by some number of minutes, wrapping at midnight in both
 * directions.
 *
 * Everything both steppers do goes through this, which is what makes 07:55 plus
 * five minutes read 08:00 rather than 07:00. Carrying is not a nicety here: an
 * hour field and a minute field that cannot reach each other make setting 08:00
 * from 07:55 a two-field edit, and the wrap is the same arithmetic.
 */
function shift(time: ClockTime, minutes: number): ClockTime {
  const total = time.hour * 60 + time.minute + minutes;
  const wrapped = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return { hour: Math.floor(wrapped / 60), minute: wrapped % 60 };
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

interface TimeFieldProps {
  /** Announced before the value, and printed over the field. */
  label: string;
  /** The number shown, already in the units this field displays. */
  value: number;
  min: number;
  max: number;
  /** A number typed into the field, already range-checked. */
  onCommit: (value: number) => void;
  onStep: (delta: 1 | -1) => void;
}

/**
 * One stepper: two buttons around an editable pair of digits.
 *
 * The text is held locally rather than derived from `value` on every render,
 * because the two disagree for as long as someone is mid-edit: an empty field
 * is a number being replaced, not a zero, and re-deriving would fill it back in
 * under the cursor. `seed` is what tells an outside change (a stepper press,
 * AM/PM moving the hour) from a change this field itself just emitted; only the
 * former rewrites the text.
 */
function TimeField({ label, value, min, max, onCommit, onStep }: TimeFieldProps) {
  const colors = useColors();

  const [text, setText] = useState(() => pad(value));
  const [seed, setSeed] = useState(value);

  if (seed !== value) {
    setSeed(value);
    setText(pad(value));
  }

  const change = (raw: string) => {
    // Digits only. A number pad still offers a minus and a decimal separator on
    // some keyboards, and neither is part of a clock.
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    setText(digits);

    if (digits.length === 0) return;

    const parsed = Number(digits);

    /*
     * The two ends of the range are not the same kind of wrong.
     *
     * Too small is usually a prefix. On a 12-hour clock the hour runs from 1,
     * and "0" is one keystroke away from "09", which is a perfectly good hour.
     * Clamping it up to 1 the instant it is typed both misreports what is
     * stored and, in a two-character field, leaves the second digit nowhere to
     * go: the field sticks at "01" and the user has to clear it to escape. So
     * it is held, uncommitted, and `onBlur` writes back whatever is actually
     * stored.
     *
     * Too big is never a prefix. No second digit rescues "70" as a minute, so
     * it clamps at once rather than sitting on screen as a figure the dialog
     * has quietly declined to save.
     */
    if (parsed < min) return;

    const clamped = Math.min(parsed, max);
    if (clamped !== parsed) setText(pad(clamped));

    // Seeded before the parent hears about it, so the value coming back is not
    // mistaken for an outside change and does not rewrite the text under the
    // cursor.
    setSeed(clamped);
    onCommit(clamped);
  };

  const step = (delta: 1 | -1) => {
    haptics.selection();
    onStep(delta);
  };

  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') step(1);
    if (event.nativeEvent.actionName === 'decrement') step(-1);
  };

  return (
    <View style={styles.field}>
      <Text variant="overline" color="textTertiary">
        {label}
      </Text>

      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: pad(value) }}
        accessibilityActions={STEPPER_ACTIONS}
        onAccessibilityAction={onAction}
        style={[styles.stepper, { backgroundColor: colors.surfaceMuted }]}
      >
        <StepperButton label={`${label} down`} glyph="−" onPress={() => step(-1)} />

        <TextInput
          value={text}
          onChangeText={change}
          // Normalises a half-typed "7" to "07" once the cursor leaves. The
          // value is already committed; this only settles how it is written.
          onBlur={() => setText(pad(value))}
          keyboardType="number-pad"
          selectTextOnFocus
          maxLength={2}
          placeholder="00"
          placeholderTextColor={colors.textTertiary}
          // Hidden from the screen reader: the adjustable wrapper above already
          // announces the same value, and reaching the raw field would announce
          // it twice under two different roles.
          accessibilityElementsHidden
          importantForAccessibility="no"
          returnKeyType="done"
          style={[styles.value, { color: colors.text }]}
        />

        <StepperButton label={`${label} up`} glyph="+" onPress={() => step(1)} />
      </View>
    </View>
  );
}

function StepperButton({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.stepperButton,
        { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
      ]}
    >
      <Text variant="subheading" color="textSecondary">
        {glyph}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface TimePickerModalProps {
  visible: boolean;
  title: string;
  /** The second line under the title. What the time will be used for. */
  message?: string;
  /** The current time as 24-hour `"HH:mm"`. Unparseable values open at 17:00. */
  value: string;
  confirmLabel?: string;
  onCancel: () => void;
  /** Receives 24-hour `"HH:mm"`, whichever clock the device presented. */
  onConfirm: (value: string) => void;
}

/**
 * The dialog. Same card, backdrop and button row as `PromptModal`.
 */
export function TimePickerModal({
  visible,
  title,
  message,
  value,
  confirmLabel = 'Save',
  onCancel,
  onConfirm,
}: TimePickerModalProps) {
  const colors = useColors();

  // Re-read on every open rather than once per process: the 24-hour setting is
  // a system toggle the user can flip while the app is running, and the answer
  // decides what the hour field counts up to.
  const [twelveHour, setTwelveHour] = useState(prefersTwelveHourClock);
  const [draft, setDraft] = useState<ClockTime>(() => parseClockTime(value) ?? FALLBACK);

  /*
   * Re-seeds each time the dialog opens, so a cancelled edit does not persist
   * into the next one. Adjusted during render against what the draft was last
   * seeded from, the way `PromptModal` does it: an effect would do the same job
   * a commit later, painting the previous edit for a frame before correcting it.
   *
   * No `generation` key any more. The wheels this used to remount were
   * uncontrolled and held their own scroll offset; the fields that replaced them
   * are driven by `draft`, so re-seeding the draft is the whole job.
   */
  const [seed, setSeed] = useState({ visible, value });

  if (seed.visible !== visible || seed.value !== value) {
    setSeed({ visible, value });
    if (visible) {
      setDraft(parseClockTime(value) ?? FALLBACK);
      setTwelveHour(prefersTwelveHourClock());
    }
  }

  const pm = draft.hour >= 12;

  /*
   * 12 rather than 0, and 12 rather than 24.
   *
   * `hour % 12` is the arithmetic, and it maps both noon and midnight to zero,
   * which is an hour no 12-hour clock has ever shown. `|| 12` is the whole
   * correction: midnight reads 12 AM and noon reads 12 PM, which is what every
   * other clock on the device says.
   */
  const shownHour = twelveHour ? draft.hour % 12 || 12 : draft.hour;

  /** A typed hour, back to the 24-hour one that is actually stored. */
  const commitHour = (hour: number) =>
    setDraft((current) => ({
      ...current,
      hour: twelveHour ? (hour % 12) + (current.hour >= 12 ? 12 : 0) : hour,
    }));

  /*
   * Snapped to the five-minute grid rather than added blindly, so a minute
   * typed off the grid lands back on it. 07:03 stepped down is 07:00, not
   * 06:58: the button is for choosing a round time, and the field is there for
   * anyone who wants 07:03 and means it.
   */
  const stepMinute = (delta: 1 | -1) =>
    setDraft((current) => {
      const snapped =
        delta > 0
          ? (Math.floor(current.minute / MINUTE_STEP) + 1) * MINUTE_STEP
          : (Math.ceil(current.minute / MINUTE_STEP) - 1) * MINUTE_STEP;

      return shift({ hour: current.hour, minute: 0 }, snapped);
    });

  const setMeridiem = (next: 'am' | 'pm') =>
    setDraft((current) => ({
      ...current,
      hour: next === 'pm' ? (current.hour % 12) + 12 : current.hour % 12,
    }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/*
        `accessible={false}` on both Pressables, deliberately: Pressable defaults
        to accessible, which would collapse the whole dialog into one element and
        take both fields away from a screen reader. See `PromptModal`, which
        carries the same pair for the same reason.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
      >
        {/* Swallows taps inside the card so they don't dismiss the modal. */}
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text variant="subheading" accessibilityRole="header">
            {title}
          </Text>
          {message && (
            <Text variant="label" color="textSecondary">
              {message}
            </Text>
          )}

          <View style={styles.time}>
            <TimeField
              label="Hour"
              value={shownHour}
              min={twelveHour ? 1 : 0}
              max={twelveHour ? 12 : 23}
              onCommit={commitHour}
              onStep={(delta) => setDraft((current) => shift(current, delta * 60))}
            />
            <Text variant="numeric" color="textTertiary" style={styles.colon}>
              :
            </Text>
            <TimeField
              label="Minute"
              value={draft.minute}
              min={0}
              max={59}
              onCommit={(minute) => setDraft((current) => ({ ...current, minute }))}
              onStep={stepMinute}
            />
          </View>

          {/*
            A segmented control rather than a third field. AM and PM are a
            two-way choice between abbreviations, which is the case
            `SettingSegmented` already documents as belonging in a track.
          */}
          {twelveHour && (
            <SegmentedControl
              label="Morning or afternoon"
              options={MERIDIEM_OPTIONS}
              value={pm ? 'pm' : 'am'}
              onChange={setMeridiem}
              style={styles.meridiem}
            />
          )}

          {/* Both buttons name what they act on: out of context a screen reader
              announces the visible word alone, and "Save" with no object is the
              same announcement in every dialog the app has. */}
          <View style={styles.actions}>
            <Button
              title="Cancel"
              accessibilityLabel={`Cancel, ${title}`}
              variant="ghost"
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              title={confirmLabel}
              accessibilityLabel={`${confirmLabel}, ${title}`}
              onPress={() => onConfirm(toClockTime(draft))}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  time: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  // Both fields share the width evenly, so the colon stays centred in the card
  // whatever the two labels are.
  field: { flex: 1, gap: spacing.xs },
  // Lifted off the baseline of the row: the fields carry a label above them, so
  // a colon aligned to the row's bottom edge sits level with the digits rather
  // than with the labels.
  colon: { paddingBottom: spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  // Past the touch minimum in both axes on its own frame, exactly as the
  // measurement stepper's are. The buttons sit close enough to their neighbours
  // that slop is not available to either: it would overlap, and the later
  // sibling silently wins the hit test.
  stepperButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  value: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
    // Android reserves extra room above the ascender and below the descender
    // from the font's own metrics, which at this size pushes the digits off the
    // centre line the buttons beside them sit on. Harmless on iOS, which
    // ignores it.
    paddingVertical: 0,
    includeFontPadding: false,
  },
  meridiem: { alignSelf: 'center', width: 160 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
