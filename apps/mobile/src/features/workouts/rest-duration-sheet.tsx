import { formatDuration } from '@lift/shared';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { Button, Text } from '@/components/ui';
import { MIN_TOUCH_SIZE, radius, spacing, useColors } from '@/theme';

/** Common working ranges: short for isolation, long for heavy compounds. */
const PRESETS = [30, 45, 60, 90, 120, 150, 180, 240, 300];

const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;
const STEP_SECONDS = 15;

/** Hoisted so the stepper's props don't change identity on every render. */
const STEPPER_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

export interface RestDurationSheetProps {
  visible: boolean;
  exerciseName: string;
  /** The rest currently in effect for this exercise, in seconds. */
  value: number;
  /** True when `value` is only the app-wide fallback, not a choice made here. */
  usingDefault: boolean;
  /** The app-wide fallback, so the reset action can name what it reverts to. */
  defaultSeconds: number;
  onCancel: () => void;
  /** `null` clears the exercise's own setting and reverts to the app default. */
  onSave: (seconds: number | null) => void;
}

/**
 * Picks the rest duration for one exercise.
 *
 * The saved value is deliberately not scoped to the current session — rest is a
 * property of the movement, not of the day. Someone who decides five minutes
 * between heavy squats should not have to decide it again next week, which is
 * why the copy says so out loud rather than leaving it to be discovered.
 */
export function RestDurationSheet({
  visible,
  exerciseName,
  value,
  usingDefault,
  defaultSeconds,
  onCancel,
  onSave,
}: RestDurationSheetProps) {
  const colors = useColors();
  const [seconds, setSeconds] = useState(value);

  // Re-seeds each time the sheet opens, so a cancelled edit doesn't leak into
  // the next one. Done during render against the props the selection was last
  // seeded from — an effect would do the same job a commit later, showing the
  // stale number for one frame.
  const [seed, setSeed] = useState({ visible, value });

  if (seed.visible !== visible || seed.value !== value) {
    setSeed({ visible, value });
    if (visible) setSeconds(value);
  }

  const adjust = (direction: 1 | -1) => setSeconds((current) => clamp(step(current, direction)));

  const onStepperAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') adjust(1);
    if (event.nativeEvent.actionName === 'decrement') adjust(-1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/*
        `accessible={false}` on both Pressables, deliberately.

        Pressable defaults to `accessible`, which collapses everything under it
        into one element — so the backdrop announced the entire sheet as a
        single button called "Rest timer 1:30 30 45 60 …" and nothing inside it
        could be reached. Tap-outside-to-dismiss has no screen reader
        equivalent here on purpose: Cancel is two swipes away, and Android's
        back gesture already routes to `onRequestClose`.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
      >
        {/* Swallows taps inside the card so they don't dismiss the sheet. */}
        <Pressable
          accessible={false}
          // Hides the screen behind the sheet from VoiceOver, so a swipe past
          // the last button lands on the heading again instead of wandering
          // into the workout underneath.
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.heading}>
            <Text variant="subheading" accessibilityRole="header">
              Rest timer
            </Text>
            <Text variant="label" color="textSecondary" numberOfLines={1}>
              {exerciseName}
            </Text>
          </View>

          {/*
            One adjustable control, not three elements.

            A screen reader reading "minus button, 1:30, plus button" makes the
            user hunt for a 15-second step; `adjustable` puts it on the swipe
            gesture the platform already reserves for exactly this. The value is
            spoken in words because "1:30" is read out as a pair of numbers.
          */}
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Rest duration"
            accessibilityValue={{
              min: MIN_SECONDS,
              max: MAX_SECONDS,
              now: seconds,
              text: spokenDuration(seconds),
            }}
            accessibilityActions={STEPPER_ACTIONS}
            onAccessibilityAction={onStepperAction}
            style={[styles.stepper, { backgroundColor: colors.surfaceMuted }]}
          >
            <Pressable
              onPress={() => adjust(-1)}
              disabled={seconds <= MIN_SECONDS}
              accessibilityRole="button"
              accessibilityLabel="Subtract 15 seconds"
              style={({ pressed }) => [
                styles.stepperButton,
                { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
                seconds <= MIN_SECONDS && styles.disabled,
              ]}
            >
              <Text variant="subheading" color="textSecondary">
                −
              </Text>
            </Pressable>

            <Text variant="numericLarge" style={styles.stepperValue}>
              {formatDuration(seconds)}
            </Text>

            <Pressable
              onPress={() => adjust(1)}
              disabled={seconds >= MAX_SECONDS}
              accessibilityRole="button"
              accessibilityLabel="Add 15 seconds"
              style={({ pressed }) => [
                styles.stepperButton,
                { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
                seconds >= MAX_SECONDS && styles.disabled,
              ]}
            >
              <Text variant="subheading" color="textSecondary">
                +
              </Text>
            </Pressable>
          </View>

          <View style={styles.presets}>
            {PRESETS.map((preset) => {
              const selected = preset === seconds;

              return (
                <Pressable
                  key={preset}
                  onPress={() => setSeconds(preset)}
                  accessibilityRole="button"
                  accessibilityLabel={`${spokenDuration(preset)} rest`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.preset,
                    {
                      backgroundColor: selected
                        ? colors.accentSurface
                        : pressed
                          ? colors.surfacePressed
                          : colors.surfaceMuted,
                      borderColor: selected ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{ color: selected ? colors.accent : colors.textSecondary }}
                  >
                    {formatDuration(preset)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="caption" color="textTertiary">
            Saved for {exerciseName} — this session and every workout after it.
          </Text>

          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="ghost"
              accessibilityLabel={`Cancel, leave the rest for ${exerciseName} unchanged`}
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              title="Save"
              accessibilityLabel={`Save ${spokenDuration(seconds)} rest for ${exerciseName}`}
              onPress={() => onSave(seconds)}
              disabled={seconds === value && !usingDefault}
              style={styles.action}
            />
          </View>

          {/* Only offered once there is something to clear — showing "use the
              default" while already on the default is a button that does nothing. */}
          {!usingDefault && (
            <Button
              title={`Use app default (${formatDuration(defaultSeconds)})`}
              variant="ghost"
              size="sm"
              fullWidth
              accessibilityLabel={`Use the app default rest of ${spokenDuration(defaultSeconds)} for ${exerciseName}`}
              // The one control here below 44pt, and the only one with room to
              // borrow: it spans the card, and the nearest thing above it is
              // 12pt of card gap. Weighted downwards, into the card's own
              // padding, so it can never steal a press from Save.
              hitSlop={{ top: 4, bottom: 12 }}
              onPress={() => onSave(null)}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The duration in words.
 *
 * `formatDuration` writes "1:30", which VoiceOver and TalkBack both read as two
 * separate numbers. Every accessibility label in this sheet quotes the spoken
 * form and leaves the colon form on screen, where it is the one that scans.
 */
function spokenDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);

  return parts.join(' ');
}

/**
 * Moves to the next multiple of the step in the direction of travel.
 *
 * Rest inherited from a routine is often an off-grid number like 100s. Adding a
 * flat 15 would keep every value after it off-grid too; landing on 105 and then
 * 120 gets back to the round numbers the presets are built from.
 */
function step(value: number, direction: 1 | -1): number {
  return direction > 0
    ? (Math.floor(value / STEP_SECONDS) + 1) * STEP_SECONDS
    : (Math.ceil(value / STEP_SECONDS) - 1) * STEP_SECONDS;
}

function clamp(value: number): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, value));
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
  heading: { gap: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  // Past the touch minimum in both axes on its own frame. The two buttons sit
  // 8pt apart inside the stepper, so slop is not available to either of them:
  // it would overlap, and the later sibling silently wins the hit test.
  stepperButton: {
    width: 52,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  stepperValue: { flex: 1, textAlign: 'center' },
  disabled: { opacity: 0.3 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Nine pills in a wrapping grid, 8pt apart in both directions: the same
  // overlap argument as the stepper, so the height is real padding rather than
  // slop. `minHeight` covers the case where a large accessibility text size
  // does not grow the line box as much as expected.
  preset: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
