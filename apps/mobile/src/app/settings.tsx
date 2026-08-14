import {
  DISTANCE_UNITS,
  MEASUREMENT_UNITS,
  ONE_REP_MAX_FORMULAS,
  ONE_REP_MAX_FORMULA_LABELS,
  THEME_PREFERENCES,
  WEIGHT_UNITS,
  formatDurationShort,
} from '@ironlog/shared';
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Card, Chip, Screen, SectionHeader, Text } from '@/components/ui';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

const REST_PRESETS = [60, 90, 120, 150, 180, 240];

const THEME_LABELS: Record<(typeof THEME_PREFERENCES)[number], string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export default function SettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

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
          Changing units only affects display. Everything is stored in kilograms and centimetres, so
          your history stays consistent.
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

        <SectionHeader title="Rest Timer" />
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
            disabled={!settings.restTimerEnabled}
          />
          <ToggleRow
            label="Notify when finished"
            value={settings.restTimerNotifications}
            onChange={(value) => update('restTimerNotifications', value)}
            disabled={!settings.restTimerEnabled}
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

        <SectionHeader title="During Workout" />
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
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Estimates diverge past about 12 reps — all of these are population regressions, not
          measurements.
        </Text>

        <Text variant="caption" color="textTertiary" align="center" style={styles.reset}>
          Defaults: {DEFAULT_SETTINGS.weightUnit.toUpperCase()} ·{' '}
          {formatDurationShort(DEFAULT_SETTINGS.defaultRestSeconds)} rest
        </Text>
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useColors();

  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.rowLabel}>
        <Text variant="body">{label}</Text>
        {description && (
          <Text variant="caption" color="textTertiary">
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.surfaceMuted }}
      />
    </View>
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
            onPress={() => onSelect(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  card: { gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { flex: 1, gap: 2 },
  disabled: { opacity: 0.4 },
  choiceRow: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  reset: { marginTop: spacing.xxl },
});
