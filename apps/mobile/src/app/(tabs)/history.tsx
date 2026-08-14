import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, isNotNull, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BodyMap, UNMAPPED_MUSCLES } from '@/components/charts/body-map';
import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { db } from '@/db/client';
import { workouts, type Workout } from '@/db/schema';
import {
  getHistoryAnalytics,
  HISTORY_METRICS,
  HISTORY_RANGES,
  type HistoryAnalytics,
  type HistoryMetric,
  type HistoryRange,
  type MuscleBreakdownEntry,
  type TrendBucket,
} from '@/features/analytics/repository';
import {
  DEFAULT_VOLUME_THRESHOLDS,
  legendSamples,
  volumeColor,
  volumeZone,
  VOLUME_ZONE_LABELS,
} from '@/features/analytics/volume-landmarks';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

interface MonthSection {
  title: string;
  /** Sort key, so December 2025 doesn't land next to December 2026. */
  key: string;
  data: Workout[];
}

/**
 * How each metric is pulled off a bucket and rendered.
 *
 * The axis formatter is deliberately terser than the readout one: the y-gutter
 * is 46px, so "12.4k" belongs there and "12,431 kg" belongs in the readout.
 */
const METRICS: Record<
  HistoryMetric,
  {
    pick: (bucket: TrendBucket) => number;
    format: (value: number, unit: WeightUnit) => string;
    axis: (value: number, unit: WeightUnit) => string;
  }
> = {
  volume: {
    pick: (bucket) => bucket.volumeKg,
    format: (value, unit) => formatVolume(value, unit),
    axis: (value, unit) => formatVolume(value, unit).replace(` ${unit}`, ''),
  },
  duration: {
    pick: (bucket) => bucket.durationSeconds,
    format: (value) => formatDurationShort(value),
    axis: (value) =>
      value >= 3600 ? `${Math.round(value / 3600)}h` : `${Math.round(value / 60)}m`,
  },
  reps: {
    pick: (bucket) => bucket.reps,
    format: (value) => `${Math.round(value).toLocaleString()} reps`,
    axis: (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value))),
  },
};

export default function HistoryScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [range, setRange] = useState<HistoryRange>('3m');
  const [metric, setMetric] = useState<HistoryMetric>('volume');
  const [analytics, setAnalytics] = useState<HistoryAnalytics | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);

  const { data: completed = [] } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt)),
  );

  // Aggregates recompute on focus and on range change rather than live: they
  // only move when a workout is finished, and re-running the muscle join on
  // every set write would be wasteful.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getHistoryAnalytics(range);
        if (!cancelled) setAnalytics(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [range]),
  );

  const sections = useMemo<MonthSection[]>(() => {
    const byMonth = new Map<string, MonthSection>();

    for (const workout of completed) {
      const date = workout.startedAt;
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;

      let section = byMonth.get(key);
      if (!section) {
        section = {
          key,
          title: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
          data: [],
        };
        byMonth.set(key, section);
      }
      section.data.push(workout);
    }

    // The source query is already newest-first, so descending key order keeps
    // months in the same direction.
    return [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [completed]);

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;

  const columns = useMemo<ColumnDatum[]>(
    () =>
      (analytics?.buckets ?? []).map((bucket) => ({
        key: bucket.start,
        label: bucket.label,
        value: METRICS[metric].pick(bucket),
      })),
    [analytics, metric],
  );

  // Denominator for each muscle's share. Sums working sets across muscles, which
  // is not `totals.sets` — that counts warm-ups too.
  const totalMuscleSets = useMemo(
    () => (analytics?.muscles ?? []).reduce((sum, entry) => sum + entry.sets, 0),
    [analytics],
  );

  if (completed.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="time-outline"
          title="No workouts yet"
          description="Finished sessions show up here with their volume, duration and records."
          action={
            <Button title="Start a Workout" onPress={() => router.push('/(tabs)/workout')} />
          }
        />
      </Screen>
    );
  }

  const active = analytics?.buckets.find((bucket) => bucket.start === selectedBucket) ?? null;

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <SegmentedControl
              options={HISTORY_RANGES}
              value={range}
              onChange={(next) => {
                setRange(next);
                setSelectedBucket(null);
              }}
              label="Time range"
            />

            <RangeTotals analytics={analytics} weightUnit={weightUnit} />

            <Card style={styles.card}>
              <SegmentedControl
                options={HISTORY_METRICS}
                value={metric}
                onChange={setMetric}
                size="sm"
                label="Metric"
                style={styles.metricTabs}
              />

              <ChartReadout
                bucket={active}
                analytics={analytics}
                metric={metric}
                weightUnit={weightUnit}
              />

              <ColumnChart
                data={columns}
                width={chartWidth}
                selectedKey={selectedBucket}
                onSelect={(datum) => setSelectedBucket(datum?.key ?? null)}
                formatValue={(value) => METRICS[metric].axis(value, weightUnit)}
              />
            </Card>

            <SectionHeader title="Muscles trained" />
            <Card style={styles.card}>
              {analytics && analytics.muscles.length > 0 ? (
                <>
                  <BodyMap
                    width={chartWidth}
                    setsPerWeek={muscleSetsPerWeek(analytics)}
                    selected={selectedMuscle}
                    onSelect={setSelectedMuscle}
                  />

                  <View style={[styles.legend, { borderTopColor: colors.border }]}>
                    <Text variant="caption" color="textTertiary">
                      Under
                    </Text>
                    <View style={styles.legendSwatches}>
                      {legendSamples().map((sets) => (
                        <View
                          key={sets}
                          style={[styles.swatch, { backgroundColor: volumeColor(sets, colors) }]}
                        />
                      ))}
                    </View>
                    <Text variant="caption" color="textTertiary">
                      Over
                    </Text>
                  </View>

                  <Text variant="caption" color="textTertiary" align="center">
                    Weekly sets against a {DEFAULT_VOLUME_THRESHOLDS.mev}–
                    {DEFAULT_VOLUME_THRESHOLDS.mrv} set target
                  </Text>

                  <View style={styles.breakdown}>
                    {analytics.muscles.map((entry) => (
                      <MuscleRow
                        key={entry.muscle}
                        entry={entry}
                        totalSets={totalMuscleSets}
                        weightUnit={weightUnit}
                        selected={selectedMuscle === entry.muscle}
                        onPress={() =>
                          setSelectedMuscle(selectedMuscle === entry.muscle ? null : entry.muscle)
                        }
                      />
                    ))}
                  </View>
                </>
              ) : (
                <Text variant="label" color="textTertiary" align="center" style={styles.noData}>
                  No completed sets in this range
                </Text>
              )}
            </Card>

            <SectionHeader title="Workouts" />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <WorkoutCard workout={item} weightUnit={weightUnit} />}
      />
    </Screen>
  );
}

/**
 * Weekly sets are an average and a half-set is meaningful at these volumes, so
 * one decimal — but not a trailing `.0` on the whole numbers most rows land on.
 */
function formatWeeklySets(setsPerWeek: number): string {
  const rounded = Math.round(setsPerWeek * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function muscleSetsPerWeek(analytics: HistoryAnalytics): Partial<Record<MuscleGroup, number>> {
  const result: Partial<Record<MuscleGroup, number>> = {};
  for (const entry of analytics.muscles) {
    result[entry.muscle] = entry.setsPerWeek;
  }
  return result;
}

function RangeTotals({
  analytics,
  weightUnit,
}: {
  analytics: HistoryAnalytics | null;
  weightUnit: WeightUnit;
}) {
  const colors = useColors();
  const totals = analytics?.totals;

  const items = [
    { label: 'Workouts', value: String(totals?.workouts ?? 0) },
    { label: 'Volume', value: formatVolume(totals?.volumeKg ?? 0, weightUnit) },
    { label: 'Time', value: formatDurationShort(totals?.durationSeconds ?? 0) },
    { label: 'Sets', value: String(totals?.sets ?? 0) },
  ];

  return (
    <View style={[styles.totals, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {items.map((item) => (
        <View key={item.label} style={styles.total}>
          <Text variant="numeric" numberOfLines={1} adjustsFontSizeToFit>
            {item.value}
          </Text>
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The line above the chart: the selected bucket if there is one, otherwise the
 * range as a whole. Tapping a bar is the only way to read an exact value, so
 * this doubles as the chart's tooltip.
 */
function ChartReadout({
  bucket,
  analytics,
  metric,
  weightUnit,
}: {
  bucket: TrendBucket | null;
  analytics: HistoryAnalytics | null;
  metric: HistoryMetric;
  weightUnit: WeightUnit;
}) {
  const config = METRICS[metric];
  const granularity = analytics?.granularity ?? 'week';

  if (bucket) {
    return (
      <View style={styles.readout}>
        <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
          {config.format(config.pick(bucket), weightUnit)}
        </Text>
        <Text variant="caption" color="textTertiary">
          {granularity === 'week' ? `Week of ${bucket.label}` : bucket.label} ·{' '}
          {bucket.workouts === 1 ? '1 workout' : `${bucket.workouts} workouts`} · {bucket.sets} sets
        </Text>
      </View>
    );
  }

  const totals = analytics?.totals;
  const total =
    metric === 'volume'
      ? (totals?.volumeKg ?? 0)
      : metric === 'duration'
        ? (totals?.durationSeconds ?? 0)
        : (totals?.reps ?? 0);

  const buckets = analytics?.buckets.length ?? 0;
  const trained = analytics?.buckets.filter((item) => item.workouts > 0).length ?? 0;

  return (
    <View style={styles.readout}>
      <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
        {config.format(total, weightUnit)}
      </Text>
      <Text variant="caption" color="textTertiary">
        {buckets > 0
          ? `across ${trained} of ${buckets} ${PERIOD_NOUNS[granularity]} · tap a bar for detail`
          : 'No data in this range'}
      </Text>
    </View>
  );
}

const PERIOD_NOUNS: Record<HistoryAnalytics['granularity'], string> = {
  week: 'weeks',
  month: 'months',
  quarter: 'quarters',
  year: 'years',
};

function MuscleRow({
  entry,
  totalSets,
  weightUnit,
  selected,
  onPress,
}: {
  entry: MuscleBreakdownEntry;
  totalSets: number;
  weightUnit: WeightUnit;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const share = totalSets === 0 ? 0 : Math.round((entry.sets / totalSets) * 100);
  const unmapped = UNMAPPED_MUSCLES.includes(entry.muscle);
  const zone = volumeZone(entry.setsPerWeek);
  const weekly = formatWeeklySets(entry.setsPerWeek);

  // The bar tracks the target range rather than the busiest muscle, so a row
  // that is short of MEV looks short even in a week where nothing hit it.
  const target = DEFAULT_VOLUME_THRESHOLDS.maxv;
  const fill = Math.min(100, (entry.setsPerWeek / target) * 100);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${MUSCLE_GROUP_LABELS[entry.muscle]}, ${weekly} sets per week, ${VOLUME_ZONE_LABELS[zone]}, ${share}% of sets`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.muscleRow,
        selected
          ? { backgroundColor: colors.accentSurface, borderColor: colors.accent }
          : pressed
            ? { backgroundColor: colors.surfacePressed }
            : null,
      ]}
    >
      <View style={styles.muscleHeader}>
        <Text variant="label" numberOfLines={1} style={styles.muscleName}>
          {MUSCLE_GROUP_LABELS[entry.muscle]}
        </Text>
        {unmapped && <Badge label="Not on map" tone="neutral" />}
        <Text variant="label" color="textSecondary">
          {weekly}/wk
        </Text>
      </View>

      <View style={[styles.muscleTrack, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.muscleFill,
            {
              backgroundColor: volumeColor(entry.setsPerWeek, colors),
              width: `${Math.max(2, fill)}%`,
            },
          ]}
        />
      </View>

      <Text variant="caption" color="textTertiary" numberOfLines={1}>
        {VOLUME_ZONE_LABELS[zone]} · {formatVolume(entry.volumeKg, weightUnit)} ·{' '}
        {entry.reps.toLocaleString()} reps ·{' '}
        {entry.exercises === 1 ? '1 exercise' : `${entry.exercises} exercises`}
      </Text>
    </Pressable>
  );
}

function WorkoutCard({ workout, weightUnit }: { workout: Workout; weightUnit: WeightUnit }) {
  return (
    <Card
      style={styles.workoutCard}
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id } })}
    >
      <View style={styles.cardHeader}>
        <Text variant="bodyMedium" numberOfLines={1} style={styles.cardTitle}>
          {workout.name}
        </Text>
        {workout.prCount > 0 && (
          <Badge
            tone="record"
            icon="trophy"
            label={workout.prCount === 1 ? '1 PR' : `${workout.prCount} PRs`}
          />
        )}
      </View>

      <Text variant="caption" color="textTertiary">
        {workout.startedAt.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })}
        {' · '}
        {workout.startedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </Text>

      <View style={styles.metrics}>
        <Metric icon="time-outline" value={formatDurationShort(workout.durationSeconds ?? 0)} />
        <Metric icon="barbell-outline" value={formatVolume(workout.totalVolumeKg, weightUnit)} />
        <Metric icon="layers-outline" value={`${workout.totalSets} sets`} />
      </View>
    </Card>
  );
}

function Metric({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={13} color={colors.textTertiary} />
      <Text variant="label" color="textSecondary">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.xs },
  totals: {
    flexDirection: 'row',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  total: { flex: 1, alignItems: 'center', gap: 2 },
  card: { gap: spacing.md },
  metricTabs: { marginBottom: spacing.xs },
  readout: { gap: 2 },
  noData: { paddingVertical: spacing.xl },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendSwatches: { flexDirection: 'row', gap: 3 },
  swatch: { width: 18, height: 8, borderRadius: 2 },
  breakdown: { gap: spacing.xs },
  muscleRow: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  muscleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muscleName: { flex: 1 },
  muscleTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  muscleFill: { height: '100%', borderRadius: radius.pill },
  sectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  workoutCard: { gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { flex: 1 },
  metrics: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  metric: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
