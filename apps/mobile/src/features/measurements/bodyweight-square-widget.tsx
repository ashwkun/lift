import { Ionicons } from '@expo/vector-icons';
import { daysSince, formatMeasurementValue, splitMeasure, type MeasurementUnitPreferences } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { SquareWidget } from '@/components/ui/widget';
import type { BodyMeasurement } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { getMeasurementHistory } from './repository';
import { describeRecency } from './insights';
import { useColors } from '@/theme';

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
    <SquareWidget
      title="Body weight"
      subtitle={subText}
      actionIcon="options-outline"
      onPress={() => router.push('/stats/body-weight')}
      onPressAction={() => router.push('/stats/body-weight')}
    >
      <Text variant="numericTitle" color="text">
        {valueText}
        {unitText ? (
          <Text variant="body" color="textSecondary">
            {' '}
            {unitText}
          </Text>
        ) : null}
      </Text>
    </SquareWidget>
  );
}
