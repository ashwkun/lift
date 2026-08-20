import {
  DISTANCE_UNITS,
  MEASUREMENT_UNITS,
  ONE_REP_MAX_FORMULAS,
  ONE_REP_MAX_FORMULA_LABELS,
  THEME_PREFERENCES,
  WEIGHT_UNITS,
  formatDurationShort,
  formatWeight,
  fromDisplayWeight,
} from '@lift/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Chip, PromptModal, Screen, SectionHeader, Text, Toggle } from '@/components/ui';
import { recordBodyweight } from '@/features/measurements/repository';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

const REST_PRESETS = [60, 90, 120, 150, 180, 240];

const THEME_LABELS: Record<(typeof THEME_PREFERENCES)[number], string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** The two numbers on this screen that are typed rather than chosen. */
type NumberField = 'bodyweight' | 'barWeight';

export default function SettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

  const [editing, setEditing] = useState<NumberField | null>(null);

  const weightUnit = settings.weightUnit;
  const asField = (kg: number) => formatWeight(kg, weightUnit, { withUnit: false });

  const prompt =
    editing === 'bodyweight'
      ? {
          title: 'Bodyweight',
          initialValue: settings.bodyweightKg == null ? '' : asField(settings.bodyweightKg),
        }
      : editing === 'barWeight'
        ? { title: 'Bar weight', initialValue: asField(settings.barWeightKg) }
        : null;

  const restOff = !settings.restTimerEnabled;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Units" />
        <Card style={styles.card}>
          <ChoiceRow
            label="Weight"
            options={WEIGHT_UNITS.map((unit) => ({ value: unit, label: unit.toUpperCase() }))}
            selected={settings.weightUnit}
            onSelect={(value) => update('weightUnit', value)}
          />
          <ChoiceRow
            label="Distance"
            options={DISTANCE_UNITS.map((unit) => ({ value: unit, label: unit.toUpperCase() }))}
            selected={settings.distanceUnit}
            onSelect={(value) => update('distanceUnit', value)}
          />
          <ChoiceRow
            label="Measurements"
            options={MEASUREMENT_UNITS.map((unit) => ({ value: unit, label: unit.toUpperCase() }))}
            selected={settings.measurementUnit}
            onSelect={(value) => update('measurementUnit', value)}
          />
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Changing units only affects display. Everything is stored in kilograms, kilometres and
          centimetres, so your history stays consistent.
        </Text>

        <SectionHeader title="Appearance" />
        <Card style={styles.card}>
          <ChoiceRow
            label="Theme"
            options={THEME_PREFERENCES.map((value) => ({ value, label: THEME_LABELS[value] }))}
            selected={settings.themePreference}
            onSelect={(value) => update('themePreference', value)}
          />
        </Card>

        <SectionHeader title="Rest timer" />
        <Card style={styles.card}>
          <ToggleRow
            label="Enable rest timer"
            value={settings.restTimerEnabled}
            onChange={(value) => update('restTimerEnabled', value)}
          />
          <ToggleRow
            label="Start automatically"
            description="Begins the moment you check off a set."
            value={settings.restTimerAutoStart}
            onChange={(value) => update('restTimerAutoStart', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <ToggleRow
            label="Notify when finished"
            description="Rings even with the app closed."
            value={settings.restTimerNotifications}
            onChange={(value) => update('restTimerNotifications', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <ToggleRow
            label="Alert sound"
            value={settings.soundEnabled}
            onChange={(value) => update('soundEnabled', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <ToggleRow
            label="Countdown buzz"
            description="A tap on each of the last three seconds."
            value={settings.restTimerCountdownCues}
            onChange={(value) => update('restTimerCountdownCues', value)}
            disabled={restOff || !settings.hapticsEnabled}
            disabledReason={restOff ? 'The rest timer is off.' : 'Haptic feedback is off.'}
          />
          <ChoiceRow
            label="Default rest"
            options={REST_PRESETS.map((seconds) => ({
              value: seconds,
              label: formatDurationShort(seconds),
            }))}
            selected={settings.defaultRestSeconds}
            onSelect={(value) => update('defaultRestSeconds', value)}
          />
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          This is only the fallback. Tap the timer next to an exercise while logging to set its own
          rest, and every future workout containing that exercise will use it.
        </Text>

        <SectionHeader title="During workout" />
        <Card style={styles.card}>
          <ToggleRow
            label="Haptic feedback"
            value={settings.hapticsEnabled}
            onChange={(value) => update('hapticsEnabled', value)}
          />
          <ToggleRow
            label="Keep screen on"
            description="Prevents the phone locking between sets."
            value={settings.keepAwakeDuringWorkout}
            onChange={(value) => update('keepAwakeDuringWorkout', value)}
          />
        </Card>

        <SectionHeader title="Body" />
        <Card style={styles.card}>
          <ValueRow
            label="Bodyweight"
            value={
              settings.bodyweightKg == null
                ? 'Not set'
                : formatWeight(settings.bodyweightKg, weightUnit, { decimals: 1 })
            }
            hint="Opens a field to enter your bodyweight."
            onPress={() => setEditing('bodyweight')}
          />
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Push-ups, pull-ups and dips are valued at your bodyweight. Without it they count as zero
          volume. Logging a bodyweight under Measurements sets this too, and entering it here files
          it there.
        </Text>

        <SectionHeader title="Calculations" />
        <Card style={styles.card}>
          <ChoiceRow
            label="1RM formula"
            options={ONE_REP_MAX_FORMULAS.map((value) => ({
              value,
              label: ONE_REP_MAX_FORMULA_LABELS[value],
            }))}
            selected={settings.oneRepMaxFormula}
            onSelect={(value) => update('oneRepMaxFormula', value)}
          />
          <ValueRow
            label="Bar weight"
            value={formatWeight(settings.barWeightKg, weightUnit, { decimals: 1 })}
            hint="Opens a field to enter the weight of your barbell."
            onPress={() => setEditing('barWeight')}
          />
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Estimates diverge past about 12 reps — all of these are population regressions, not
          measurements. The bar weight is what the plate line under each barbell exercise counts up
          from.
        </Text>

        <Text variant="caption" color="textTertiary" align="center" style={styles.reset}>
          Defaults: {DEFAULT_SETTINGS.weightUnit.toUpperCase()} ·{' '}
          {formatDurationShort(DEFAULT_SETTINGS.defaultRestSeconds)} rest
        </Text>
      </ScrollView>

      <PromptModal
        visible={prompt !== null}
        title={prompt?.title ?? ''}
        message={`Entered in ${weightUnit}`}
        initialValue={prompt?.initialValue ?? ''}
        placeholder="0"
        confirmLabel="Save"
        onCancel={() => setEditing(null)}
        onConfirm={(raw) => {
          const field = editing;
          setEditing(null);
          if (!field) return;

          const parsed = Number(raw.replace(',', '.'));
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          const kg = fromDisplayWeight(parsed, weightUnit);

          if (field === 'barWeight') {
            update('barWeightKg', kg);
            return;
          }

          // Filed as a measurement rather than written straight to the store:
          // the repository mirrors it back into settings, and this way the entry
          // also lands on the bodyweight chart instead of being a second number
          // that quietly disagrees with it.
          void recordBodyweight(kg);
        }}
      />
    </Screen>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
  disabledReason,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Why the row is dead. Replaces the description, and is read out with the label. */
  disabledReason?: string;
}) {
  const colors = useColors();

  // A disabled row describes behaviour that is not happening, so the reason it
  // is dead is the more useful of the two lines — and the only one that tells
  // the user which switch above to turn back on.
  const detail = disabled ? disabledReason : description;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      // The reason is folded in rather than left to the visual line beside it,
      // because a screen reader announcing a disabled switch with no explanation
      // is a dead end.
      accessibilityLabel={disabled && disabledReason ? `${label}. ${disabledReason}` : label}
      accessibilityHint={disabled ? undefined : description}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      {/* Only the label dims. `Toggle` dims itself when disabled, and nesting
          that inside a dimmed row would multiply the two into near-invisibility. */}
      <View style={[styles.rowLabel, disabled && styles.disabled]}>
        <Text variant="body">{label}</Text>
        {detail && (
          <Text variant="caption" color="textTertiary">
            {detail}
          </Text>
        )}
      </View>
      {/* The row is the 44pt target; the switch is only its readout. */}
      <Toggle presentational value={value} onValueChange={onChange} disabled={disabled} />
    </Pressable>
  );
}

function ValueRow({
  label,
  value,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  hint: string;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Text variant="body" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="numeric" color="textSecondary">
        {value}
      </Text>
    </Pressable>
  );
}

function ChoiceRow<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.choiceRow}>
      <Text variant="body">{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => (
          <Chip
            key={String(option.value)}
            label={option.label}
            selected={selected === option.value}
            // A chip is ~34pt tall; 6pt each way makes the 44. Vertical only —
            // horizontal slop on a row of chips would let a neighbour's slop
            // overlap the chip beside it, and the later sibling silently wins.
            // The wrapped rows sit `rowGap` 12 apart precisely so the two halves
            // tile instead of overlapping.
            hitSlop={CHIP_HIT_SLOP}
            onPress={() => onSelect(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

const CHIP_HIT_SLOP = { top: 6, bottom: 6 } as const;

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  card: { gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    // Bled out to the card's edge and back so the pressed fill spans the full
    // width of the row it belongs to; the card clips it to its own radius.
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  rowLabel: { flex: 1, gap: 2 },
  disabled: { opacity: 0.4 },
  choiceRow: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.md },
  hint: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  reset: { marginTop: spacing.xxl },
});
