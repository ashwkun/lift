import { Ionicons } from '@expo/vector-icons';
import {
  MEASUREMENT_KINDS,
  MEASUREMENT_KIND_LABELS,
  formatMeasurement,
  formatWeight,
  fromDisplayMeasurement,
  fromDisplayWeight,
  type MeasurementKind,
} from '@lift/shared';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { LineChart } from '@/components/charts/line-chart';
import { Card, Divider, PromptModal, Screen, SectionHeader, Text } from '@/components/ui';
import type { BodyMeasurement } from '@/db/schema';
import {
  getLatestMeasurements,
  getMeasurementHistory,
  recordMeasurement,
} from '@/features/measurements/repository';
import { useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

export default function MeasurementsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { weightUnit, measurementUnit } = useSettings();

  const [latest, setLatest] = useState<Map<MeasurementKind, BodyMeasurement>>(new Map());
  const [expanded, setExpanded] = useState<MeasurementKind | null>(null);
  const [history, setHistory] = useState<BodyMeasurement[]>([]);
  const [entering, setEntering] = useState<MeasurementKind | null>(null);

  const reload = useCallback(async () => {
    setLatest(await getLatestMeasurements());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openHistory = async (kind: MeasurementKind) => {
    if (expanded === kind) {
      setExpanded(null);
      return;
    }
    setExpanded(kind);
    setHistory(await getMeasurementHistory(kind));
  };

  /** Converts a display-unit entry into the canonical storage value. */
  const toStorage = (kind: MeasurementKind, value: number): number => {
    if (kind === 'bodyweight') return fromDisplayWeight(value, weightUnit);
    if (kind === 'body_fat') return value; // already a percentage
    return fromDisplayMeasurement(value, measurementUnit);
  };

  const format = (kind: MeasurementKind, value: number): string => {
    if (kind === 'bodyweight') return formatWeight(value, weightUnit, { decimals: 1 });
    if (kind === 'body_fat') return `${value.toFixed(1)} %`;
    return formatMeasurement(value, measurementUnit);
  };

  const unitLabel = (kind: MeasurementKind): string => {
    if (kind === 'bodyweight') return weightUnit;
    if (kind === 'body_fat') return '%';
    return measurementUnit;
  };

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Measurements' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Track" />
        <Card padded={false}>
          {MEASUREMENT_KINDS.map((kind, index) => {
            const current = latest.get(kind);
            const isOpen = expanded === kind;

            return (
              <View key={kind}>
                {index > 0 && <Divider inset={spacing.lg} />}

                {/* Two siblings under a plain View, not a Pressable inside a
                    Pressable: Android's touch handling gives the whole area to
                    the outer one, so the nested "add" button was unreachable
                    there and only ever worked on iOS. Each half now carries its
                    own 44pt of padding, which also removes the hitSlop that
                    would have overlapped its neighbour. */}
                <View style={styles.row}>
                  <Pressable
                    onPress={() => void openHistory(kind)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      current
                        ? `${MEASUREMENT_KIND_LABELS[kind]}, ${format(kind, current.value)}`
                        : `${MEASUREMENT_KIND_LABELS[kind]}, not recorded`
                    }
                    accessibilityHint="Shows the trend for this measurement."
                    accessibilityState={{ expanded: isOpen }}
                    style={({ pressed }) => [
                      styles.rowMain,
                      pressed && { backgroundColor: colors.surfacePressed },
                    ]}
                  >
                    <Text variant="body" style={styles.rowLabel}>
                      {MEASUREMENT_KIND_LABELS[kind]}
                    </Text>

                    <Text variant="numeric" color={current ? 'text' : 'textTertiary'}>
                      {current ? format(kind, current.value) : '—'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setEntering(kind)}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${MEASUREMENT_KIND_LABELS[kind]}`}
                    style={({ pressed }) => [
                      styles.add,
                      pressed && { backgroundColor: colors.surfacePressed },
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
                  </Pressable>
                </View>

                {isOpen && history.length > 1 && (
                  <View style={styles.chart}>
                    <LineChart
                      data={history.map((row) => ({
                        x: row.measuredAt.getTime(),
                        y:
                          kind === 'bodyweight'
                            ? Number(formatWeight(row.value, weightUnit, { withUnit: false }))
                            : row.value,
                      }))}
                      width={chartWidth}
                      height={140}
                      formatValue={(value) => value.toFixed(1)}
                      formatLabel={(x) =>
                        new Date(x).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })
                      }
                    />
                  </View>
                )}

                {isOpen && history.length <= 1 && (
                  <Text variant="caption" color="textTertiary" style={styles.chartHint}>
                    Log at least two entries to see a trend.
                  </Text>
                )}
              </View>
            );
          })}
        </Card>
      </ScrollView>

      <PromptModal
        visible={entering !== null}
        title={entering ? `Log ${MEASUREMENT_KIND_LABELS[entering]}` : ''}
        message={entering ? `Entered in ${unitLabel(entering)}` : undefined}
        placeholder="0.0"
        confirmLabel="Log"
        onCancel={() => setEntering(null)}
        onConfirm={(raw) => {
          const kind = entering;
          setEntering(null);
          if (!kind) return;

          const parsed = Number(raw.replace(',', '.'));
          if (!Number.isFinite(parsed) || parsed <= 0) return;

          void recordMeasurement({ kind, value: toStorage(kind, parsed) }).then(async () => {
            await reload();
            if (expanded === kind) setHistory(await getMeasurementHistory(kind));
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.lg,
  },
  add: {
    minWidth: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.lg - spacing.sm,
  },
  rowLabel: { flex: 1 },
  chart: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  chartHint: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
