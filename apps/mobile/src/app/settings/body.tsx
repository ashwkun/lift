import {
  SEXES,
  SEX_LABELS,
  formatClockTime,
  formatMeasurement,
  formatWeight,
  fromDisplayMeasurement,
  fromDisplayWeight,
  toDisplayMeasurement,
  trimZeros,
  type Sex,
} from '@lift/shared';
import { useState } from 'react';

import { Card, Divider, PromptModal, Reveal, TimePickerModal } from '@/components/ui';
import { recordBodyweight } from '@/features/measurements/repository';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingChoice, SettingToggle, SettingValue } from '@/features/settings/rows';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** `null` is a real choice here, so it needs a value the picker can hold. */
const UNSET = 'unset';
type SexChoice = Sex | typeof UNSET;

const SEX_OPTIONS: { value: SexChoice; label: string }[] = [
  ...SEXES.map((value) => ({ value: value as SexChoice, label: SEX_LABELS[value] })),
  { value: UNSET as SexChoice, label: 'Not set' },
];

/** The two figures on this page that are typed rather than chosen. */
type PromptField = 'bodyweight' | 'height';

export default function BodySettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

  const [editing, setEditing] = useState<PromptField | null>(null);
  const [editingTime, setEditingTime] = useState(false);

  const weightUnit = settings.weightUnit;
  const measurementUnit = settings.measurementUnit;

  /** The stored "HH:mm" as the device writes a clock: "8:00 am" or "08:00". */
  const weighInTime = formatClockTime(settings.weighInReminderTime);

  /**
   * The same three-can-fail shape as the gym reminder's switch, and the same
   * rule: the preference is only recorded once something is genuinely pending
   * with the OS, so a switch that stays off is always a switch with a reason.
   */
  const toggleWeighIn = async (enabled: boolean) => {
    const weighIn = await import('@/features/notifications/weigh-in');

    if (!enabled) {
      update('weighInReminderEnabled', false);
      await weighIn.cancelWeighInReminder();
      return;
    }

    const permission = await weighIn.prepareWeighInNotifications();

    if (permission === 'unsupported') {
      await showAlert(
        'Reminders are not available here',
        'Scheduling one needs a development or store build. Expo Go on Android and the browser build both run without a notification module.',
      );
      return;
    }

    if (permission === 'denied') {
      await showAlert(
        'Notifications are off',
        'Lift needs permission to post notifications before it can remind you to weigh in. Turn them on for Lift in your phone settings, then try again.',
      );
      return;
    }

    if (!(await weighIn.scheduleWeighInReminder(settings.weighInReminderTime))) {
      await showAlert(
        'Reminder not set',
        'The weigh-in reminder could not be scheduled. Check that notifications are still enabled for Lift in your phone settings.',
      );
      return;
    }

    update('weighInReminderEnabled', true);
  };

  const prompt =
    editing === 'bodyweight'
      ? {
          title: 'Bodyweight',
          unit: weightUnit,
          initialValue:
            settings.bodyweightKg == null
              ? ''
              : formatWeight(settings.bodyweightKg, weightUnit, { withUnit: false }),
        }
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

  return (
    <SettingsPage title="Body">
      <Reveal>
        <Card padded={false} style={settingsStyles.first}>
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

        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingToggle
            icon="alarm-outline"
            label="Weigh-in reminder"
            // Names the hour for the same reason the gym reminder's switch
            // does, and then the part that makes this one different: the
            // notification takes the number, so nobody has to guess whether
            // acting on it means opening the app.
            description={`A daily nudge at ${weighInTime}. Type the reading straight into it.`}
            value={settings.weighInReminderEnabled}
            onChange={(value) => void toggleWeighIn(value)}
          />
          <Divider inset={spacing.lg} />
          <SettingValue
            icon="time-outline"
            label="Reminder time"
            value={weighInTime}
            hint="Opens the time picker"
            onPress={() => setEditingTime(true)}
          />
        </Card>
        <Footnote>
          A weigh-in is only comparable with the one before it if both were taken under the same
          conditions, which for most people means first thing. The notification carries a field:
          type the number, send it, and it is logged without the app opening. Tap the notification
          itself instead and it opens the bodyweight chart with the entry sheet already up.
        </Footnote>
      </Reveal>

      <TimePickerModal
        visible={editingTime}
        title="Weigh-in time"
        message="Repeats every day."
        value={settings.weighInReminderTime}
        onCancel={() => setEditingTime(false)}
        onConfirm={(time) => {
          setEditingTime(false);
          update('weighInReminderTime', time);

          // The only way to move a scheduled notification is to cancel it and
          // post a new one. Skipped while the reminder is off: the switch
          // schedules from the stored time when it is turned on.
          if (settings.weighInReminderEnabled) {
            void import('@/features/notifications/weigh-in').then(({ scheduleWeighInReminder }) =>
              scheduleWeighInReminder(time),
            );
          }
        }}
      />

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

          // Filed as a measurement rather than written straight to the store:
          // the repository mirrors it back into settings, and this way the entry
          // also lands on the bodyweight chart instead of being a second number
          // that quietly disagrees with it.
          void recordBodyweight(fromDisplayWeight(parsed, weightUnit));
        }}
      />
    </SettingsPage>
  );
}
