import {
  DISTANCE_UNITS,
  MEASUREMENT_UNITS,
  ONE_REP_MAX_FORMULAS,
  ONE_REP_MAX_FORMULA_LABELS,
  SEXES,
  SEX_LABELS,
  WEIGHT_UNITS,
  estimateOneRepMax,
  formatDuration,
  formatMeasurement,
  formatWeight,
  fromDisplayMeasurement,
  fromDisplayWeight,
  toDisplayMeasurement,
  trimZeros,
  type OneRepMaxFormula,
  type Sex,
} from '@lift/shared';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import {
  Card,
  Divider,
  PromptModal,
  Reveal,
  Screen,
  SectionHeader,
  StatBand,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { recordBodyweight } from '@/features/measurements/repository';
import {
  SettingAction,
  SettingChoice,
  SettingSegmented,
  SettingToggle,
  SettingValue,
} from '@/features/settings/rows';
import { THEME_LABELS, ThemePicker } from '@/features/settings/theme-picker';
import { showConfirm } from '@/store/dialog';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** Read once: the manifest cannot change while the process is alive. */
const APP_VERSION = Constants.expoConfig?.version;

/**
 * Rest presets, in seconds.
 *
 * Labelled with `formatDuration` — "1:30" — rather than `formatDurationShort`,
 * which writes whole minutes and rendered 60 and 90 as the same "1m" and 120
 * and 150 as the same "2m". Four presets, two labels, and no way to tell from
 * the screen which of each pair was selected. Every other rest control in the
 * app already uses the colon form; this one now agrees with them.
 */
const REST_PRESETS = [60, 90, 120, 150, 180, 240];

/**
 * The set the formula picker compares its options on.
 *
 * A one-rep max estimate is a ratio applied to the weight, so eight reps at 100
 * of *anything* returns the same figure in that same unit — which is why the
 * preview carries no unit and needs no conversion when someone switches to
 * pounds.
 *
 * Eight reps rather than five, and that is measured rather than chosen: at five,
 * Brzycki and O'Conner return exactly 112.5 and the preview would print two of
 * the six options as identical, which is the opposite of what it is there to
 * show. Eight is an ordinary working set and separates all six — 120.0 through
 * 127.7, which is the honest size of the decision being made.
 */
const FORMULA_REFERENCE = { weight: 100, reps: 8 } as const;

/**
 * Sunday and Monday only.
 *
 * These are the two the world actually splits on, and `firstDayOfWeek` is typed
 * to match. A Saturday start exists in parts of the Middle East and North
 * Africa; it is not offered here because nothing else in the app — the weekly
 * streak, the history buckets — would honour it, and a preference that only
 * half the screens obey is worse than one that isn't offered.
 *
 * Held as strings because that is what a picker's options are keyed by, and
 * mapped back to the 0 | 1 the store stores at the one call site below.
 */
type FirstDayChoice = '0' | '1';

const FIRST_DAY_OPTIONS: { value: FirstDayChoice; label: string }[] = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
];

/** The numbers on this screen that are typed rather than chosen. */
type NumberField = 'bodyweight' | 'barWeight' | 'height';

/** `null` is a real choice here, so it needs a value the picker can hold. */
const UNSET = 'unset';
type SexChoice = Sex | typeof UNSET;

const SEX_OPTIONS: { value: SexChoice; label: string }[] = [
  ...SEXES.map((value) => ({ value: value as SexChoice, label: SEX_LABELS[value] })),
  { value: UNSET as SexChoice, label: 'Not set' },
];

export default function SettingsScreen() {
  const scrollEdge = useScrollEdge();

  const settings = useSettings();
  const update = useSettings((state) => state.update);
  const reset = useSettings((state) => state.reset);

  const [editing, setEditing] = useState<NumberField | null>(null);

  const weightUnit = settings.weightUnit;
  const measurementUnit = settings.measurementUnit;
  const asField = (kg: number) => formatWeight(kg, weightUnit, { withUnit: false });

  const prompt =
    editing === 'bodyweight'
      ? {
          title: 'Bodyweight',
          unit: weightUnit,
          initialValue: settings.bodyweightKg == null ? '' : asField(settings.bodyweightKg),
        }
      : editing === 'barWeight'
        ? { title: 'Bar weight', unit: weightUnit, initialValue: asField(settings.barWeightKg) }
        : editing === 'height'
          ? {
              title: 'Height',
              unit: measurementUnit,
              initialValue:
                settings.heightCm == null
                  ? ''
                  : trimZeros(toDisplayMeasurement(settings.heightCm, measurementUnit).toFixed(1)),
            }
          : null;

  const restOff = !settings.restTimerEnabled;

  const confirmReset = async () => {
    const confirmed = await showConfirm({
      title: 'Reset settings?',
      message:
        'Units, theme, rest timer and calculation preferences go back to their defaults. Your workouts, exercises, measurements and body figures are not touched.',
      confirmLabel: 'Reset',
    });

    if (confirmed) await reset();
  };

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * What this screen currently amounts to, before any of it is scrolled.
         *
         * It repeats three rows from further down, deliberately. This screen is
         * seven sections and several phone-heights long, and the question
         * that brings most people to it — am I in kilos, how long is my rest,
         * why is the app light — is answerable in three words that would
         * otherwise be spread across a thousand points of scroll. The same
         * masthead-then-band rhythm as the profile screen it is opened from, so
         * arriving here reads as going deeper rather than as landing somewhere
         * else.
         *
         * Weight leads because it is the one people come here to change.
         */}
        <Reveal>
          <StatBand
            style={styles.band}
            items={[
              { label: 'Weight', value: weightUnit.toUpperCase(), lead: true },
              {
                label: 'Default rest',
                value: restOff ? 'Off' : formatDuration(settings.defaultRestSeconds),
              },
              { label: 'Theme', value: THEME_LABELS[settings.themePreference] },
            ]}
          />
        </Reveal>

        <Reveal index={1}>
          <SectionHeader title="Units" />
          <Card padded={false} style={styles.section}>
            {/*
             * Inline tracks rather than pickers: each of these is a choice
             * between two two-letter abbreviations, and sending that through a
             * modal costs two taps and a sheet to move one letter. Everything
             * below whose options are words goes through a picker instead.
             */}
            <SettingSegmented
              icon="barbell-outline"
              label="Weight"
              options={WEIGHT_UNITS.map((unit) => ({ value: unit, label: unit.toUpperCase() }))}
              value={settings.weightUnit}
              onChange={(value) => update('weightUnit', value)}
            />
            <Divider inset={spacing.lg} />
            <SettingSegmented
              icon="navigate-outline"
              label="Distance"
              options={DISTANCE_UNITS.map((unit) => ({ value: unit, label: unit.toUpperCase() }))}
              value={settings.distanceUnit}
              onChange={(value) => update('distanceUnit', value)}
            />
            <Divider inset={spacing.lg} />
            <SettingSegmented
              icon="resize-outline"
              label="Measurements"
              options={MEASUREMENT_UNITS.map((unit) => ({
                value: unit,
                label: unit.toUpperCase(),
              }))}
              value={settings.measurementUnit}
              onChange={(value) => update('measurementUnit', value)}
            />
          </Card>
          {/* Two sentences, and the second one exists because the first is no
              longer the whole story: an exercise can carry its own unit, set from
              the column heading while logging it. Someone who switches the app to
              kilograms and finds one exercise still reading in pounds should be
              able to find out why from the screen they just used. */}
          <Footnote>
            Changing units only affects display. Everything is stored in kilograms, kilometres and
            centimetres, so your history stays consistent. An exercise can override this from its
            column heading in a workout — the dumbbell rack in pounds, the plates in kilos.
          </Footnote>
        </Reveal>

        <Reveal index={2}>
          <SectionHeader title="Appearance" />
          <Card style={styles.section}>
            <ThemePicker
              value={settings.themePreference}
              onChange={(value) => update('themePreference', value)}
            />
          </Card>
          {/* Which column the calendar's grid opens on. Stored as a number
              because that is what `Date.getDay()` returns and what the grid
              rotates by; the two labels are the only forms a user ever sees. */}
          <Card padded={false} style={styles.sectionStacked}>
            <SettingChoice
              icon="calendar-outline"
              label="Week starts on"
              options={FIRST_DAY_OPTIONS}
              // The cast is exact rather than convenient: `firstDayOfWeek` is
              // typed `0 | 1`, so its string form is `'0' | '1'` and nothing
              // else. TypeScript widens `String()` to `string` regardless.
              value={String(settings.firstDayOfWeek) as FirstDayChoice}
              onChange={(value) => update('firstDayOfWeek', value === '1' ? 1 : 0)}
            />
          </Card>
        </Reveal>

        <Reveal index={3}>
          <SectionHeader title="Rest timer" />
          {/*
           * The master switch, alone in its own card.
           *
           * Everything in the card below it is dead while this is off, and a
           * disabled row sitting directly under the switch that disabled it is
           * ambiguous about which way the dependency runs. Two cards state it:
           * this is the thing, those are its settings.
           */}
          <Card padded={false} style={styles.section}>
            <SettingToggle
              icon="timer-outline"
              label="Rest timer"
              description="Counts down between sets."
              value={settings.restTimerEnabled}
              onChange={(value) => update('restTimerEnabled', value)}
            />
          </Card>

          <Card padded={false} style={styles.sectionStacked}>
            <SettingChoice
              icon="hourglass-outline"
              label="Default rest"
              options={REST_PRESETS.map((seconds) => ({
                value: String(seconds),
                label: formatDuration(seconds),
              }))}
              value={String(settings.defaultRestSeconds)}
              onChange={(value) => update('defaultRestSeconds', Number(value))}
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="play-circle-outline"
              label="Start automatically"
              description="Begins the moment you check off a set."
              value={settings.restTimerAutoStart}
              onChange={(value) => update('restTimerAutoStart', value)}
              disabled={restOff}
              disabledReason="The rest timer is off."
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="notifications-outline"
              label="Notify when finished"
              description="Rings even with the app closed."
              value={settings.restTimerNotifications}
              onChange={(value) => update('restTimerNotifications', value)}
              disabled={restOff}
              disabledReason="The rest timer is off."
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="volume-medium-outline"
              label="Alert sound"
              description="Beeps through the last ten seconds, then the bell."
              value={settings.soundEnabled}
              onChange={(value) => update('soundEnabled', value)}
              disabled={restOff}
              disabledReason="The rest timer is off."
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="pulse-outline"
              label="Countdown buzz"
              description="A tap on each of the last three seconds."
              value={settings.restTimerCountdownCues}
              onChange={(value) => update('restTimerCountdownCues', value)}
              disabled={restOff || !settings.hapticsEnabled}
              disabledReason={restOff ? 'The rest timer is off.' : 'Haptic feedback is off.'}
            />
          </Card>
          <Footnote>
            The default is only a fallback. Tap the timer next to an exercise while logging to set
            its own rest, and every future workout containing that exercise will use it.
          </Footnote>
        </Reveal>

        <Reveal index={4}>
          <SectionHeader title="During workout" />
          <Card padded={false} style={styles.section}>
            <SettingToggle
              icon="phone-portrait-outline"
              label="Haptic feedback"
              // Deliberately general. `features/feedback/haptics.ts` fires on
              // sets, timers, deletions, reorders and refusals, across the whole
              // app rather than only inside a workout — a description naming
              // any one of those would be describing a fraction of the switch.
              description="Short taps confirming what you just did."
              value={settings.hapticsEnabled}
              onChange={(value) => update('hapticsEnabled', value)}
            />
            <Divider inset={spacing.lg} />
            <SettingToggle
              icon="eye-outline"
              label="Keep screen on"
              description="Prevents the phone locking between sets."
              value={settings.keepAwakeDuringWorkout}
              onChange={(value) => update('keepAwakeDuringWorkout', value)}
            />
          </Card>
        </Reveal>

        <Reveal index={5}>
          <SectionHeader title="Body" />
          <Card padded={false} style={styles.section}>
            <SettingValue
              icon="scale-outline"
              label="Bodyweight"
              value={
                settings.bodyweightKg == null
                  ? 'Not set'
                  : formatWeight(settings.bodyweightKg, weightUnit, { decimals: 1 })
              }
              hint="Opens a field to enter your bodyweight."
              onPress={() => setEditing('bodyweight')}
            />
            <Divider inset={spacing.lg} />
            <SettingValue
              icon="body-outline"
              label="Height"
              value={
                settings.heightCm == null
                  ? 'Not set'
                  : formatMeasurement(settings.heightCm, measurementUnit)
              }
              hint="Opens a field to enter your height."
              onPress={() => setEditing('height')}
            />
            <Divider inset={spacing.lg} />
            <SettingChoice
              icon="person-outline"
              label="Sex"
              options={SEX_OPTIONS}
              value={settings.sex ?? UNSET}
              onChange={(value) => update('sex', value === UNSET ? null : value)}
            />
          </Card>
          <Footnote>
            Push-ups, pull-ups and dips are valued at your bodyweight. Without it they count as zero
            volume. Logging a bodyweight under Measurements sets this too, and entering it here files
            it there.
          </Footnote>
          <Footnote>
            Height and sex are read by two estimates on the measurements screen and nothing else: BMI
            and waist-to-height need the height, and the body-fat estimate is a regression fitted
            separately for each sex. Leave either blank and only those figures go quiet. Both stay on
            this device unless you turn on sync.
          </Footnote>
        </Reveal>

        <Reveal index={6}>
          <SectionHeader title="Calculations" />
          <Card padded={false} style={styles.section}>
            <SettingChoice
              icon="analytics-outline"
              label="1RM formula"
              options={ONE_REP_MAX_FORMULAS.map((value) => ({
                value,
                label: ONE_REP_MAX_FORMULA_LABELS[value],
                description: formulaPreview(value),
              }))}
              value={settings.oneRepMaxFormula}
              onChange={(value) => update('oneRepMaxFormula', value)}
            />
            <Divider inset={spacing.lg} />
            <SettingValue
              icon="barbell-outline"
              label="Bar weight"
              value={formatWeight(settings.barWeightKg, weightUnit, { decimals: 1 })}
              hint="Opens a field to enter the weight of your barbell."
              onPress={() => setEditing('barWeight')}
            />
          </Card>
          <Footnote>
            Estimates diverge past about 12 reps — all of these are population regressions, not
            measurements. The bar weight is what the plate line under each barbell exercise counts up
            from.
          </Footnote>
        </Reveal>

        {/*
         * Reset, last and on its own.
         *
         * This replaces a footer that read "Defaults: KG · 2m" — a statement of
         * what the defaults were, on a screen with no way to return to them. The
         * store has had a `reset` since it was written and nothing had ever
         * called it. The subtitle quotes `DEFAULT_SETTINGS` rather than naming
         * the values again, so it cannot drift from what the button does.
         */}
        <Reveal index={7}>
          <SectionHeader title="Reset" />
          <Card padded={false} style={styles.section}>
            <SettingAction
              icon="refresh-outline"
              label="Reset all settings"
              description={`Back to ${DEFAULT_SETTINGS.weightUnit.toUpperCase()}, ${formatDuration(
                DEFAULT_SETTINGS.defaultRestSeconds,
              )} rest and the system theme`}
              onPress={confirmReset}
            />
          </Card>

          {/* The build number, which is what people quote in a bug report — and
              the same footer the profile screen ends on. */}
          <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
            {APP_VERSION ? `Lift ${APP_VERSION}` : 'Lift'}
          </Text>
        </Reveal>
      </ScrollView>

      <PromptModal
        visible={prompt !== null}
        title={prompt?.title ?? ''}
        message={prompt ? `Entered in ${prompt.unit}` : undefined}
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

          if (field === 'height') {
            update('heightCm', fromDisplayMeasurement(parsed, measurementUnit));
            return;
          }

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

/**
 * What one formula makes of the reference set, as a line under its name.
 *
 * Six surnames is not a choice anybody can make. What separates them is how
 * hard each one extrapolates, and one worked example per option shows the whole
 * spread in the place the decision is actually taken, rather than describing it
 * in a footnote below the card.
 */
function formulaPreview(formula: OneRepMaxFormula): string {
  const { weight, reps } = FORMULA_REFERENCE;
  const estimate = estimateOneRepMax(weight, reps, formula);

  return `${weight} × ${reps} reps ≈ ${trimZeros(estimate.toFixed(1))}`;
}

/**
 * A note under a card, in the tertiary tier.
 *
 * Inset past the card's own edge rather than aligned to it, which is where the
 * eye expects a caption about the thing above it — flush left, it reads as
 * another row that lost its background.
 */
function Footnote({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textTertiary" style={styles.footnote}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  band: { marginHorizontal: spacing.lg },
  section: { marginHorizontal: spacing.lg },
  // A second card in the same section, under the first. The gap is the section
  // header's own bottom padding, so two cards inside one section sit closer
  // together than two sections do.
  sectionStacked: { marginHorizontal: spacing.lg, marginTop: spacing.sm },
  footnote: {
    marginHorizontal: spacing.lg + spacing.xs,
    marginTop: spacing.sm,
  },
  footer: { marginTop: spacing.xxl },
});
