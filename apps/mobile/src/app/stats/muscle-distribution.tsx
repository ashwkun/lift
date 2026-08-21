import {
  BODY_PART_LABELS,
  formatDurationShort,
  formatVolume,
  type WeightUnit,
} from '@lift/shared';
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { RadarChart, RadarLegend, type RadarAxis } from '@/components/charts/radar-chart';
import { Card, Divider, Screen, Text, splitMeasure, useScrollEdge } from '@/components/ui';
import { pluralSets } from '@/features/analytics/format';
import {
  getMuscleDistributionReport,
  type DistributionReport,
} from '@/features/analytics/muscle-stats';
import { RangePicker } from '@/features/analytics/range-picker';
import { deltaOf, SummaryGrid, type SummaryFigure } from '@/features/analytics/summary-grid';
import { STAT_RANGE_LABELS, type StatRange } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing, useContentWidth } from '@/theme';

/** What a figure reads while its range is still being counted. */
const PENDING = '—';

export default function MuscleDistributionScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window — see `useContentWidth`.
  const width = useContentWidth();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [range, setRange] = useState<StatRange>('30d');
  const [report, setReport] = useState<DistributionReport | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getMuscleDistributionReport(range).catch(() => null);
        if (!cancelled) setReport(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [range]),
  );

  // Figures from the range the user just left are still figures, and nothing on
  // this screen is labelled by range — so they are dropped the instant the
  // picker moves rather than sitting under the wrong heading.
  const ranged = report?.range === range ? report : null;

  const axes = useMemo<RadarAxis[]>(
    () =>
      (ranged?.axes ?? []).map((axis) => ({
        key: axis.bodyPart,
        label: BODY_PART_LABELS[axis.bodyPart],
        value: axis.current,
        previous: axis.previous,
      })),
    [ranged],
  );

  // The plot is square and sized off the card's inner width, capped so it does
  // not push the summary grid off a small screen entirely.
  const plotSize = Math.min(width - spacing.lg * 4, 320);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Muscle distribution' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <RangePicker value={range} onChange={setRange} />

        <Card style={styles.chartCard}>
          {ranged ? (
            <>
              <View style={styles.plot}>
                <RadarChart axes={axes} width={plotSize} max={ranged.peak} />
              </View>

              <RadarLegend
                currentLabel={STAT_RANGE_LABELS[range]}
                previousLabel={ranged.previousTotals ? 'Previous' : 'No earlier window'}
              />

              <Divider />

              <Text variant="caption" color="textTertiary" align="center">
                {ranged.peak > 0
                  ? `Outer ring: ${pluralSets(ranged.peak)}`
                  : 'No completed sets in this range'}
              </Text>
            </>
          ) : (
            // Holds the plot's height so the summary grid below does not jump
            // up and back down as the range is counted.
            <View style={[styles.plot, { height: plotSize }]}>
              <Text variant="label" color="textTertiary">
                {PENDING}
              </Text>
            </View>
          )}
        </Card>

        <SummaryGrid items={summaryFigures(ranged, weightUnit)} />

        {ranged && ranged.unplottedSets > 0 && (
          <Text variant="caption" color="textTertiary" style={styles.footnote}>
            {pluralSets(ranged.unplottedSets)} fell outside the six groups above — cardio,
            full-body and neck work have no axis on the chart, but they are still counted in the
            set total.
          </Text>
        )}

        <Text variant="caption" color="textTertiary" style={styles.footnote}>
          Each axis counts sets whose target muscle belongs to that group. Both shapes share one
          scale, so a heavier block draws a bigger shape rather than the same one rescaled — which
          is what makes a deload visible here at all.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function summaryFigures(report: DistributionReport | null, weightUnit: WeightUnit): SummaryFigure[] {
  const totals = report?.totals;
  const previous = report?.previousTotals ?? null;

  const [volume, volumeUnit]: [string, string | undefined] = totals
    ? splitMeasure(formatVolume(totals.volumeKg, weightUnit))
    : [PENDING, undefined];

  const [deltaVolume, deltaVolumeUnit]: [string, string | undefined] =
    totals && previous
      ? splitMeasure(formatVolume(Math.abs(totals.volumeKg - previous.volumeKg), weightUnit))
      : [PENDING, undefined];

  return [
    {
      label: 'Workouts',
      value: totals ? String(totals.workouts) : PENDING,
      delta: totals ? deltaOf(totals.workouts, previous?.workouts, (n) => String(n)) : null,
    },
    {
      label: 'Duration',
      value: totals ? formatDurationShort(totals.durationSeconds) : PENDING,
      delta: totals
        ? deltaOf(totals.durationSeconds, previous?.durationSeconds, formatDurationShort)
        : null,
    },
    {
      label: 'Volume',
      value: volume,
      unit: volumeUnit,
      // The magnitude is formatted through `splitMeasure` above rather than
      // recomputed here, so the delta prints "2.1k kg" the same way the figure
      // it sits under does.
      delta:
        totals && previous
          ? {
              direction:
                totals.volumeKg > previous.volumeKg
                  ? 'up'
                  : totals.volumeKg < previous.volumeKg
                    ? 'down'
                    : 'flat',
              text: [deltaVolume, deltaVolumeUnit].filter(Boolean).join(' '),
            }
          : null,
    },
    {
      label: 'Sets',
      value: totals ? String(totals.sets) : PENDING,
      delta: totals ? deltaOf(totals.sets, previous?.sets, (n) => String(n)) : null,
    },
  ];
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  chartCard: { gap: spacing.md },
  plot: { alignItems: 'center', justifyContent: 'center' },
  footnote: { paddingHorizontal: spacing.xs },
});
