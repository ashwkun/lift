import {
  formatDurationShort,
  formatVolume,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, isNotNull, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BodyMap, UNMAPPED_MUSCLES } from '@/components/charts/body-map';
import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Reveal,
  Screen,
  SegmentedControl,
  splitMeasure,
  StatBand,
  Text,
} from '@/components/ui';
import { db } from '@/db/client';
import { workouts, type Workout } from '@/db/schema';
import { useRows } from '@/db/use-rows';
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
import { formatSets } from '@/features/analytics/format';
import {
  DEFAULT_VOLUME_THRESHOLDS,
  volumeColor,
  volumeZone,
  VOLUME_ZONE_LABELS,
} from '@/features/analytics/volume-landmarks';
import { VolumeLegend } from '@/features/analytics/volume-legend';
import { WorkoutCard } from '@/features/workouts/workout-card';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

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
    axis: (value) =>
      value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value)),
  },
};

export default function HistoryScreen() {
  const { width } = useWindowDimensions();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [range, setRange] = useState<HistoryRange>('3m');
  const [metric, setMetric] = useState<HistoryMetric>('volume');
  const [analytics, setAnalytics] = useState<HistoryAnalytics | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);

  const { rows: completed, loaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt)),
  );

  // Aggregates recompute on focus and on range change rather than live: they
  // only move when a workout is finished, and re-running the muscle join on
  // every set write would be wasteful.
  useDeferredFocusEffect(
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

  // The query is asynchronous, so `analytics` still describes the range the user
  // just moved off for as long as it takes to run. Every figure on this screen
  // is unlabelled by range — the segmented control is the only thing that says
  // which window they belong to — so leaving them up puts three-month totals
  // under "Year" and they are read as fact. Matching on the range the result
  // carries drops them the instant the control moves, and needs no reset in the
  // handler that a later range source could forget.
  const ranged = analytics?.range === range ? analytics : null;

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
      (ranged?.buckets ?? []).map((bucket) => ({
        key: bucket.start,
        label: bucket.label,
        value: METRICS[metric].pick(bucket),
      })),
    [ranged, metric],
  );

  // Denominator for each muscle's share. Sums working sets across muscles, which
  // is not `totals.sets` — that counts warm-ups too.
  const totalMuscleSets = useMemo(
    () => (ranged?.muscles ?? []).reduce((sum, entry) => sum + entry.sets, 0),
    [ranged],
  );

  // The list query answers a tick after mount and seeds `[]` until it does, so
  // the empty state has to wait for it: otherwise every visit to this screen
  // opens on "No workouts yet" and corrects itself a frame later. The header
  // stays mounted through all three states so the native title never flashes
  // the route name.
  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'History' }} />
      </Screen>
    );
  }

  if (completed.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'History' }} />
        <Reveal>
          <EmptyState
            icon="time-outline"
            title="No workouts yet"
            description="Finished sessions show up here with their volume, duration and records."
            action={<Button title="Go to Workout" onPress={() => router.push('/(tabs)/workout')} />}
          />
        </Reveal>
      </Screen>
    );
  }

  const active = ranged?.buckets.find((bucket) => bucket.start === selectedBucket) ?? null;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'History' }} />
      {/* The list is held behind `loaded` and its analytics are held behind the
          push transition, so it arrives some way into the screen's life. The
          `Reveal` is what makes that arrival a settle rather than a flash of
          bare canvas replaced by a full page of cards. `flex` on the wrapper so
          the list still measures against the screen and not against itself. */}
      <Reveal style={styles.flex}>
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

              <RangeTotals analytics={ranged} weightUnit={weightUnit} />

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
                  analytics={ranged}
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

              {/* Written as a plain overline rather than `SectionHeader`, whose
                own 32px indent is right on the grouped-list screens and wrong
                here: this list is already inset by `styles.list`, so the shared
                component put this header 16px to the right of the month rules
                below it and of every card it sits above. */}
              <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
                Muscles trained
              </Text>
              <Card style={styles.card}>
                {/* Nothing at all until the muscles belong to the range on screen:
                  a map coloured from the last window reads as this one's. */}
                {!ranged ? null : ranged.muscles.length > 0 ? (
                  <>
                    <BodyMap
                      width={chartWidth}
                      setsPerWeek={muscleSetsPerWeek(ranged)}
                      selected={selectedMuscle}
                      onSelect={setSelectedMuscle}
                    />

                    <VolumeLegend />

                    <View style={styles.breakdown}>
                      {ranged.muscles.map((entry) => (
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
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => <WorkoutCard workout={item} weightUnit={weightUnit} />}
        />
      </Reveal>
    </Screen>
  );
}

function muscleSetsPerWeek(analytics: HistoryAnalytics): Partial<Record<MuscleGroup, number>> {
  const result: Partial<Record<MuscleGroup, number>> = {};
  for (const entry of analytics.muscles) {
    result[entry.muscle] = entry.setsPerWeek;
  }
  return result;
}

/**
 * What a figure reads while its range is still being counted.
 *
 * Not zero: "0 workouts" is a claim about the user's training, and it was the
 * wrong one every time they changed the range.
 */
const PENDING = '—';

function RangeTotals({
  analytics,
  weightUnit,
}: {
  analytics: HistoryAnalytics | null;
  weightUnit: WeightUnit;
}) {
  const totals = analytics?.totals;

  // Four figures across a phone is one too many for a single ruled band, so
  // these run as two bands of two — which also pairs them by kind: what was
  // done, and how much of it.
  const [volume, volumeUnit]: [string, string | undefined] = totals
    ? splitMeasure(formatVolume(totals.volumeKg, weightUnit))
    : [PENDING, undefined];

  return (
    <View>
      <StatBand
        items={[
          { label: 'Workouts', value: totals ? String(totals.workouts) : PENDING },
          { label: 'Time', value: totals ? formatDurationShort(totals.durationSeconds) : PENDING },
        ]}
      />
      <StatBand
        items={[
          { label: 'Volume', value: volume, unit: volumeUnit },
          { label: 'Sets', value: totals ? String(totals.sets) : PENDING },
        ]}
      />
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

  // The figure holds its line while the range is being counted — and the second
  // line is deliberately blank rather than absent, so the chart below it doesn't
  // step up and back down under a thumb already reaching for a bar.
  if (!analytics) {
    return (
      <View style={styles.readout}>
        <Text variant="numericLarge">{PENDING}</Text>
        <Text variant="caption" color="textTertiary">
          {' '}
        </Text>
      </View>
    );
  }

  const granularity = analytics.granularity;

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

  const totals = analytics.totals;
  const total =
    metric === 'volume'
      ? totals.volumeKg
      : metric === 'duration'
        ? totals.durationSeconds
        : totals.reps;

  const buckets = analytics.buckets.length;
  const trained = analytics.buckets.filter((item) => item.workouts > 0).length;

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
  const weekly = formatSets(entry.setsPerWeek);

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
        // The resting outline is the card fill this row sits on rather than
        // `transparent`: the border is drawn in every state, so selecting one
        // cannot reflow the row, and a see-through stroke around a radius
        // seams on Android. See `stroke` in the tokens.
        selected
          ? { backgroundColor: colors.accentSurface, borderColor: colors.accent }
          : pressed
            ? { backgroundColor: colors.surfacePressed, borderColor: colors.surfacePressed }
            : { borderColor: colors.surface },
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.xs },
  card: { gap: spacing.md },
  metricTabs: { marginBottom: spacing.xs },
  readout: { gap: 2 },
  noData: { paddingVertical: spacing.xl },
  breakdown: { gap: spacing.xs },
  muscleRow: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  muscleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muscleName: { flex: 1 },
  muscleTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  muscleFill: { height: '100%', borderRadius: radius.pill },
  sectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.sm },
});
