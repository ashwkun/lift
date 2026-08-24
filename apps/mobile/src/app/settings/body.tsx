import {
  SEXES,
  SEX_LABELS,
  formatMeasurement,
  formatWeight,
  fromDisplayMeasurement,
  fromDisplayWeight,
  toDisplayMeasurement,
  trimZeros,
  type Sex,
} from '@lift/shared';
import { useState } from 'react';

import { Card, Divider, PromptModal, Reveal } from '@/components/ui';
import { recordBodyweight } from '@/features/measurements/repository';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingChoice, SettingValue } from '@/features/settings/rows';
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

  const weightUnit = settings.weightUnit;
  const measurementUnit = settings.measurementUnit;

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
      </Reveal>

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
