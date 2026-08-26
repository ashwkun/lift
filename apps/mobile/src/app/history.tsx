import {
  dayKey,
  formatDurationShort,
  formatVolume,
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  volumeZone,
  VOLUME_ZONE_LABELS,
  type MuscleGroup,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, isNotNull, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { BodyMap, UNMAPPED_MUSCLES } from '@/components/charts/body-map';
import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Reveal,
  Screen,
  SearchBar,
  SegmentedControl,
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { getWorkoutCalendar, type WorkoutCalendar } from '@/features/analytics/calendar';
import { ContributionGraph } from '@/features/analytics/contribution-graph';
import {
  getHistoryAnalytics,
  HISTORY_RANGES,
  isHistoryFilterActive,
  searchWorkouts,
  type HistoryAnalytics,
  type HistoryFilter,
  type HistoryMatch,
  type HistoryRange,
  type MuscleBreakdownEntry,
  type TrendBucket,
} from '@/features/analytics/repository';
import { formatSets } from '@/features/analytics/format';
import { METRIC, TREND_METRICS, type TrendMetric } from '@/features/analytics/metrics';
import { volumeColor } from '@/features/analytics/volume-landmarks';
import { VolumeLegend } from '@/features/analytics/volume-legend';
import { MuscleFilter } from '@/features/exercises/muscle-filter';
import { WorkoutCard } from '@/features/workouts/workout-card';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors, useContentWidth } from '@/theme';

interface MonthSection {
  title: string;
  /** Sort key, so December 2025 doesn't land next to December 2026. */
  key: string;
  data: HistoryMatch[];
}

/**
 * A set of matches, tagged with the question it answers.
 *
 * The tag is what separates "still counting" from "counted, and there are
 * none": a bare array cannot tell those apart, and the difference is a screen
 * that says "No matching workouts" under every half-typed word.
 */
interface HistoryMatches {
  key: string;
  workouts: HistoryMatch[];
}

export default function HistoryScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const weightUnit = useSettings((state) => state.weightUnit);
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  const [range, setRange] = useState<HistoryRange>('3m');
  const [metric, setMetric] = useState<TrendMetric>('volume');
  const [analytics, setAnalytics] = useState<HistoryAnalytics | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);
  const [limitVal, setLimitVal] = useState(25);
  const [calendar, setCalendar] = useState<WorkoutCalendar | null>(null);
  const [search, setSearch] = useState('');
  // Separate from `selectedMuscle` above, which highlights one muscle on the
  // body map and in the breakdown beside it. That is a way of reading the
  // range's own figures; this is a way of narrowing the sessions underneath
  // them, and it is multi-select because "shoulders or triceps" is one question.
  // Driving both off one piece of state was the first shape tried and it was
  // wrong in both directions: tapping the map to read a number silently
  // reshaped a list two screens further down, and filtering to a muscle moved
  // a highlight nobody was looking at.
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [matches, setMatches] = useState<HistoryMatches | null>(null);

  const { rows: completed, loaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(limitVal),
    [limitVal]
  );

  // Deferred for the same reason the exercise picker defers its own field: the
  // keystroke must never wait on the work it starts. The case is stronger here
  // than there, because what it starts is a SQLite query rather than an array
  // filter, and on the web build that query crosses into WASM.
  const deferredSearch = useDeferredValue(search);

  const filter = useMemo<HistoryFilter>(
    () => ({ text: deferredSearch, muscles }),
    [deferredSearch, muscles],
  );

  const filtering = isHistoryFilterActive(filter);

  // Identity of the *question*, and deliberately not of how much of it was
  // asked for: `limitVal` is left out so that paging further into a set of
  // results keeps the rows already on screen up while the longer page is
  // fetched, instead of blanking the list under a scrolling thumb.
  const filterKey = `${filter.text.trim()}\u0000${[...muscles].sort().join(',')}`;

  // Not `useDeferredFocusEffect`. That hook holds a screen's arrival queries
  // behind the navigation transition, which is right for a dashboard and wrong
  // for a field somebody is typing into: it would put the results behind
  // whatever else the app had queued.
  useEffect(() => {
    // An empty log has nothing to match, and this guard doubles as the one
    // thing that keeps a set of results honest: `completed` is the live query,
    // so its identity changes exactly when the workouts table does, and naming
    // it here re-runs the search when a session is deleted from inside one.
    if (!filtering || completed.length === 0) return;

    let cancelled = false;

    void (async () => {
      const found = await searchWorkouts(filter, limitVal);
      if (!cancelled) setMatches({ key: filterKey, workouts: found });
    })();

    return () => {
      cancelled = true;
    };
  }, [filtering, filter, filterKey, limitVal, completed]);

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

  // Unlike `analytics` this doesn't depend on `range`: the graph always covers
  // a year, so refetching it on every range change would be wasted work for a
  // block that never changes shape.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getWorkoutCalendar();
        if (!cancelled) setCalendar(next);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The query is asynchronous, so `analytics` still describes the range the user
  // just moved off for as long as it takes to run. Every figure on this screen
  // is unlabelled by range. The segmented control is the only thing that says
  // which window they belong to, so leaving them up puts three-month totals
  // under "Year" and they are read as fact. Matching on the range the result
  // carries drops them the instant the control moves, and needs no reset in the
  // handler that a later range source could forget.
  const ranged = analytics?.range === range ? analytics : null;

  // Matches only while they answer the filter on screen. Stale ones are held
  // rather than cleared, so clearing a search and retyping it shows the
  // previous answer immediately and corrects it a tick later, the same trade
  // `ranged` makes above.
  const matched = filtering && matches?.key === filterKey ? matches.workouts : null;

  // Three states, and none of them is the same as the others: no filter is the
  // live query, a filter that has answered is its matches, and a filter still
  // running is nothing at all. The third is what keeps "No matching workouts"
  // off the screen while somebody is halfway through typing "bench".
  const rows: readonly HistoryMatch[] = filtering ? (matched ?? NO_MATCHES) : completed;

  const sections = useMemo<MonthSection[]>(() => {
    const byMonth = new Map<string, MonthSection>();

    for (const workout of rows) {
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
  }, [rows]);

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;

  const columns = useMemo<ColumnDatum[]>(
    () =>
      (ranged?.buckets ?? []).map((bucket) => ({
        key: bucket.start,
        label: bucket.label,
        value: METRIC[metric].pick(bucket),
      })),
    [ranged, metric],
  );

  // Denominator for each muscle's share. Sums working sets across muscles, which
  // is not `totals.sets`. That counts warm-ups too.
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
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'History' }} />
      </Screen>
    );
  }

  if (completed.length === 0) {
    return (
      <Screen scrolled={scrollEdge.progress}>
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
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'History' }} />

      {/* Pinned above the list rather than folded into its header, which is
          where the range control and the charts live. That header scrolls away
          with them, and a search field you have to scroll back up to reach is
          one you cannot clear from wherever the result you were reading is.
          Same two controls in the same order as `exercise/picker.tsx`, so the
          one search gesture in this app works in both places. No `autoFocus`
          here though: this screen is opened to read a dashboard far more often
          than it is opened to find one session, and a keyboard covering half of
          it on arrival would be answering a question nobody asked. */}
      <View style={styles.search}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder="Search sessions and exercises"
          accessibilityLabel="Search workout history"
        />

        <View style={styles.filters}>
          <MuscleFilter values={muscles} onChange={setMuscles} />
        </View>
      </View>

      {/* The list is held behind `loaded` and its analytics are held behind the
          push transition, so it arrives some way into the screen's life. The
          `Reveal` is what makes that arrival a settle rather than a flash of
          bare canvas replaced by a full page of cards. `flex` on the wrapper so
          the list still measures against the screen and not against itself. */}
      <Reveal style={styles.flex}>
        <SectionList
          {...scrollEdge.list}
          sections={sections}
          keyExtractor={(item) => item.id}
          onEndReached={() => {
            // Only when the page came back full. A filtered list is usually
            // shorter than the viewport, and a list that never fills its
            // viewport re-fires `onEndReached` on every render: unfiltered that
            // walked the limit up for nothing, and under a search each step is
            // another query.
            if (rows.length >= limitVal) setLimitVal((l) => l + 25);
          }}
          onEndReachedThreshold={0.5}
          stickySectionHeadersEnabled={false}
          // The field above stays up while the results are scrolled, so a tap
          // on a session has to open it rather than spend itself dismissing the
          // keyboard.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            // Filtering swaps the whole dashboard for one line. What it stands
            // in for is four cards tall: range totals, the trend chart, the
            // body map and a year of activity, none of which answers the
            // question that was typed, and all of which would push the matches
            // off the bottom of the screen. Nothing here is reset to do it, so
            // clearing brings the same range, metric and selected bar straight
            // back.
            filtering ? (
              <MatchCount count={matched?.length ?? null} limit={limitVal} />
            ) : (
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
                    options={TREND_METRICS}
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
                    formatValue={(value) => METRIC[metric].axis(value, weightUnit)}
                    describeValue={(value) => METRIC[metric].format(value, weightUnit)}
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
                              setSelectedMuscle(
                                selectedMuscle === entry.muscle ? null : entry.muscle,
                              )
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

                {/* Unscoped by the range control above: a year of squares reads
                    as consistency, which is a different question from "how much
                    in the last 3 months" and shouldn't move when that answer
                    does. */}
                <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
                  Activity
                </Text>
                <Card style={styles.card}>
                  <ContributionGraph
                    days={calendar?.days ?? EMPTY_DAYS}
                    typicalVolumeKg={calendar?.typicalVolumeKg ?? 0}
                    firstDayOfWeek={firstDayOfWeek}
                    today={new Date()}
                    weightUnit={weightUnit}
                    onSelectDay={(date) =>
                      router.push({ pathname: '/calendar', params: { date: dayKey(date) } })
                    }
                  />
                </Card>
              </View>
            )
          }
          ListEmptyComponent={
            // Only once the query has answered: `matched` is null until then,
            // which is what stops this announcing that nothing matches a word
            // the user is still halfway through. An unfiltered list never
            // reaches here at all, since the screen returns its own empty state
            // above when there is no history to show.
            matched ? (
              <EmptyState
                icon="search"
                title="No matching workouts"
                description="Try a different exercise name, or clear the search."
              />
            ) : null
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

/** Stable identity for the pre-load render, so the graph doesn't rebuild on each frame. */
const EMPTY_DAYS: WorkoutCalendar['days'] = new Map();

/** Stable identity for a search that hasn't answered yet, so `sections` doesn't rebuild. */
const NO_MATCHES: readonly HistoryMatch[] = [];

/**
 * The line the dashboard is replaced by while a filter is on.
 *
 * Nothing at all until the query has answered, and nothing when it answered
 * with none: a "0" above an empty list says the same thing twice, and the
 * empty state below says it better.
 */
function MatchCount({ count, limit }: { count: number | null; limit: number }) {
  if (count === null || count === 0) return null;

  // A full page may have more behind it. The query is capped at the same limit
  // the list pages with, so exactly `limit` rows means "at least this many" and
  // printing it flat would be a claim about the log that happens to be false.
  // Anything short of the cap is the real total.
  const total = count >= limit ? `${count}+` : String(count);

  return (
    <Text
      variant="caption"
      color="textTertiary"
      style={styles.matchCount}
      // Announced rather than merely rendered: someone searching by voice or
      // with a screen reader is typing into a field that is nowhere near the
      // rows it changes, and the count is the only feedback that it worked.
      accessibilityLiveRegion="polite"
    >
      {count === 1 ? '1 matching workout' : `${total} matching workouts`}
    </Text>
  );
}

function RangeTotals({
  analytics,
  weightUnit,
}: {
  analytics: HistoryAnalytics | null;
  weightUnit: WeightUnit;
}) {
  const totals = analytics?.totals;

  // Four figures across a phone is one too many for a single ruled band, so
  // these run as two bands of two, which also pairs them by kind: what was
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
  metric: TrendMetric;
  weightUnit: WeightUnit;
}) {
  const config = METRIC[metric];

  // The figure holds its line while the range is being counted, and the second
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
  const landmarks = landmarksFor(entry.muscle);
  const zone = volumeZone(entry.setsPerWeek, landmarks);
  const weekly = formatSets(entry.setsPerWeek);

  // The bar tracks this muscle's own recoverable ceiling rather than the busiest
  // muscle, so a row that is short of MEV looks short even in a week where
  // nothing hit it. Muscles with no ceiling: cardio and the other buckets that
  // are not muscles. Get an empty track rather than a division by zero.
  const fill = landmarks.mrv <= 0 ? 0 : Math.min(100, (entry.setsPerWeek / landmarks.mrv) * 100);

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
              backgroundColor: volumeColor(entry.setsPerWeek, colors, landmarks),
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
  // No bottom padding: the list below already opens with `spacing.lg` of its
  // own, and doubling it would leave the field floating.
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  matchCount: { paddingBottom: spacing.xs },
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
