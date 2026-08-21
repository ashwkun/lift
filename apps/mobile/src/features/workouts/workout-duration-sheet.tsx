import { formatDurationShort } from '@lift/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import { MIN_TOUCH_SIZE, radius, spacing, stroke, useColors } from '@/theme';

/** A day. Past this the figure is a bug in someone's clock, not a session. */
const MAX_SECONDS = 24 * 60 * 60;

/** What a gym session actually lasts, for the common corrections. */
const PRESETS = [30, 45, 60, 75, 90, 120].map((minutes) => minutes * 60);

export interface WorkoutDurationSheetProps {
  visible: boolean;
  /** Named in the heading, so the sheet says which session it is about to change. */
  workoutName: string;
  /** The duration currently stored, in seconds. */
  value: number;
  onCancel: () => void;
  onSave: (seconds: number) => void;
}

/**
 * Corrects how long a finished session took.
 *
 * The duration is wall-clock between starting and saving, which is right until
 * the phone goes in a locker and the session is closed out the next morning.
 * The stored figure then reads as fourteen hours, and because it is stored
 * rather than derived it goes on dragging every weekly total and every average
 * that reads it. There was previously no screen anywhere that could reach it.
 *
 * Two fields rather than the rest timer's stepper: rest is nudged in fifteen-
 * second hops around a number the user half-remembers, and a session duration
 * is a figure they already know — "it was about an hour and ten" — so the
 * fastest control is the one that takes it dictated. The presets cover the
 * cases where they don't, which is most of them.
 *
 * Minutes past 59 are not rejected. "90" is a perfectly ordinary way to say an
 * hour and a half, and the total is normalised on save rather than argued with
 * mid-keystroke.
 */
export function WorkoutDurationSheet({
  visible,
  workoutName,
  value,
  onCancel,
  onSave,
}: WorkoutDurationSheetProps) {
  const colors = useColors();

  const [hours, setHours] = useState(() => String(Math.floor(value / 3600)));
  const [minutes, setMinutes] = useState(() => String(Math.floor((value % 3600) / 60)));

  // Re-seeds each time the sheet opens, so a cancelled edit doesn't leak into
  // the next one. Done during render against the props the fields were last
  // seeded from — an effect would do the same job a commit later, showing the
  // stale figure for one frame. Same arrangement as `RestDurationSheet`.
  const [seed, setSeed] = useState({ visible, value });

  if (seed.visible !== visible || seed.value !== value) {
    setSeed({ visible, value });
    if (visible) {
      setHours(String(Math.floor(value / 3600)));
      setMinutes(String(Math.floor((value % 3600) / 60)));
    }
  }

  const seconds = Math.min(MAX_SECONDS, digits(hours) * 3600 + digits(minutes) * 60);

  const applyPreset = (preset: number) => {
    setHours(String(Math.floor(preset / 3600)));
    setMinutes(String(Math.floor((preset % 3600) / 60)));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* The card holds two text fields, so it has to move out from under the
          keyboard. Android resizes the window itself; iOS does not. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* `accessible={false}` on both Pressables: Pressable defaults to
            accessible, which would collapse the whole sheet into one element.
            See the longer note in `RestDurationSheet`. */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onCancel}
        >
          {/* Swallows taps inside the card so they don't dismiss the sheet. */}
          <Pressable
            accessible={false}
            accessibilityViewIsModal
            style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.heading}>
              <Text variant="subheading" accessibilityRole="header">
                Duration
              </Text>
              <Text variant="label" color="textSecondary" numberOfLines={1}>
                {workoutName}
              </Text>
            </View>

            <View style={styles.fields}>
              <TextField
                label="Hours"
                accessibilityLabel="Hours"
                value={hours}
                onChangeText={setHours}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                containerStyle={styles.field}
                style={styles.fieldText}
              />
              <TextField
                label="Minutes"
                accessibilityLabel="Minutes"
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                maxLength={3}
                selectTextOnFocus
                containerStyle={styles.field}
                style={styles.fieldText}
              />
            </View>

            <View style={styles.presets}>
              {PRESETS.map((preset) => {
                const selected = preset === seconds;

                return (
                  <Pressable
                    key={preset}
                    onPress={() => applyPreset(preset)}
                    accessibilityRole="button"
                    accessibilityLabel={spokenDuration(preset)}
                    accessibilityState={{ selected }}
                    style={({ pressed }) => {
                      const fill = selected
                        ? colors.accentSurface
                        : pressed
                          ? colors.surfacePressed
                          : colors.surfaceMuted;

                      // Unselected, the outline is the fill rather than
                      // transparent — same reasoning as `Chip`.
                      return [
                        styles.preset,
                        { backgroundColor: fill, borderColor: selected ? colors.accent : fill },
                      ];
                    }}
                  >
                    <Text
                      variant="label"
                      style={{ color: selected ? colors.accent : colors.textSecondary }}
                    >
                      {formatDurationShort(preset)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Said plainly, because the two are easy to conflate: this is how
                long the session took, not when it happened. */}
            <Text variant="caption" color="textTertiary">
              How long the session took. The date it was logged on doesn&apos;t move.
            </Text>

            <View style={styles.actions}>
              <Button
                title="Cancel"
                variant="ghost"
                accessibilityLabel="Cancel, leave the duration unchanged"
                onPress={onCancel}
                style={styles.action}
              />
              <Button
                title="Save"
                accessibilityLabel={`Save a duration of ${spokenDuration(seconds)}`}
                onPress={() => onSave(seconds)}
                disabled={seconds === value}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A field's digits as a number; an empty or half-typed box counts as nothing. */
function digits(text: string): number {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The duration in words. `formatDurationShort` writes "1h 24m", which both
 * screen readers spell out letter by letter.
 */
function spokenDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

  return parts.join(' ');
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
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  heading: { gap: 2 },
  fields: { flexDirection: 'row', gap: spacing.md },
  field: { flex: 1 },
  // Centred and set large: these two boxes are the whole point of the sheet,
  // and a left-aligned "1" in a full-width field reads as an accident.
  fieldText: { textAlign: 'center' },
  // Six pills in a wrapping grid, 8pt apart in both directions, so the height
  // is real padding rather than slop — overlapping slop is silently won by the
  // later sibling. Same reasoning as the rest sheet's presets.
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: stroke.outline,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
