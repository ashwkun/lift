import { Ionicons } from '@expo/vector-icons';
import { daysSince, formatMeasurementValue, type MeasurementUnitPreferences } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, splitMeasure } from '@/components/ui';
import { SquareWidget } from '@/components/ui/widget';
import type { BodyMeasurement } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { getMeasurementHistory, recordMeasurement } from './repository';
import { describeRecency } from './insights';
import { useColors } from '@/theme';
import { MeasurementEntrySheet, type MeasurementEntryInput } from './entry-sheet';
import { haptics } from '@/features/feedback/haptics';

export function BodyweightSquareWidget() {
  const colors = useColors();

  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);
  const prefs = useMemo<MeasurementUnitPreferences>(
    () => ({ weightUnit, measurementUnit }),
    [weightUnit, measurementUnit],
  );

  const [rows, setRows] = useState<BodyMeasurement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [logging, setLogging] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const history = await getMeasurementHistory('bodyweight').catch(() => null);
    if (history) {
      setRows(history);
      setNow(Date.now());
    }
    setLoaded(true);
  }, []);

  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const latest = rows[0];

  const submit = (input: MeasurementEntryInput) => {
    setLogging(false);
    haptics.logged();
    void (async () => {
      await recordMeasurement({ kind: 'bodyweight', ...input });
      await reload();
      await import('@/features/notifications/weigh-in')
        .then(({ refreshWeighInReminder }) => refreshWeighInReminder())
        .catch(() => {});
    })();
  };

  if (!loaded) return null;

  let valueText = '--';
  let unitText = '';
  let subText = 'No weigh-ins';

  if (latest) {
    const [figure, unit] = splitMeasure(formatMeasurementValue('bodyweight', latest.value, prefs));
    valueText = figure;
    unitText = unit || '';
    const days = daysSince(latest.measuredAt.getTime(), now);
    subText = describeRecency(days) || 'Today';
  }

  return (
    <>
      <SquareWidget
        title="Body weight"
        subtitle={subText}
        actionIcon="add-outline"
        onPress={() => setLogging(true)}
        onPressAction={() => setLogging(true)}
      >
        <Text variant="numericLarge" color="text">
          {valueText}
          {unitText ? (
            <Text variant="body" color="textSecondary">
              {' '}
              {unitText}
            </Text>
          ) : null}
        </Text>
      </SquareWidget>
      <MeasurementEntrySheet
        visible={logging}
        kind={logging ? 'bodyweight' : null}
        previous={latest}
        onCancel={() => setLogging(false)}
        onSubmit={submit}
      />
    </>
  );
}
