import { DISTANCE_UNITS, MEASUREMENT_UNITS, WEIGHT_UNITS } from '@lift/shared';

import { Card, Divider, Reveal } from '@/components/ui';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingSegmented } from '@/features/settings/rows';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/**
 * What the numbers in the app are written in.
 *
 * Three rows, and they are the first page off the hub because the weight unit
 * is the setting people open Settings to change.
 */
export default function UnitsSettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

  return (
    <SettingsPage title="Units">
      <Reveal>
        <Card padded={false} style={settingsStyles.first}>
          {/*
           * Inline tracks rather than pickers: each of these is a choice
           * between two two-letter abbreviations, and sending that through a
           * modal costs two taps and a sheet to move one letter. Everything in
           * the app whose options are words goes through a picker instead.
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
          column heading in a workout: the dumbbell rack in pounds, the plates in kilos.
        </Footnote>
      </Reveal>
    </SettingsPage>
  );
}
