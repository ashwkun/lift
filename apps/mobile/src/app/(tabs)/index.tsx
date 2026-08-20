import { formatDurationShort, formatVolume } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import {
  Button,
  Card,
  Divider,
  ListRow,
  Reveal,
  Screen,
  SectionHeader,
  splitMeasure,
  StatBand,
  Text,
} from '@/components/ui';
import {
  getDashboardStats,
  getMuscleDistribution,
  getWeeklyVolume,
  type DashboardStats,
  type MuscleDistributionEntry,
  type WeeklyVolumePoint,
} from '@/features/analytics/repository';
import { listCompletedWorkouts } from '@/features/workouts/repository';
import type { Workout } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

const BODY_PART_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  legs: 'Legs',
  other: 'Other',
};

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyVolumePoint[]>([]);
  const [distribution, setDistribution] = useState<MuscleDistributionEntry[]>([]);
  const [recent, setRecent] = useState<Workout[]>([]);

  // Aggregates are recomputed on focus rather than live — they only change when
  // a workout is finished, and re-running them on every set write would be
  // wasteful.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const [nextStats, nextWeekly, nextDistribution, nextRecent] = await Promise.all([
          getDashboardStats(),
          getWeeklyVolume(12),
          getMuscleDistribution(30),
          listCompletedWorkouts(3),
        ]);

        if (cancelled) return;
        setStats(nextStats);
        setWeekly(nextWeekly);
        setDistribution(nextDistribution);
        setRecent(nextRecent);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Screen width less the page margin. The charts are unboxed, so they measure
  // against the same gutter as every other element here.
  const chartWidth = width - spacing.lg * 2;

  /*
   * Hold the frame until the first aggregate lands, and then show the
   * dashboard whatever it says.
   *
   * This screen used to paint twice before it was right: `stats` starts null,
   * so the first frame was a 40px "0 kg" masthead over a zeroed streak, and
   * then, if the query came back with no workouts, the whole thing was replaced
   * by a full-page "Let's get started". Wrong figures, then a dead end where
   * the dashboard belongs.
   *
   * Holding on `!stats` removes the first; deleting the empty branch removes
   * the second. A zeroed dashboard is the honest first-run state — the charts
   * already say "Not enough data yet" in their own words, and the layout the
   * user is about to inhabit is legible from launch rather than hidden behind a
   * poster. Only the recent-workouts block hides, because an empty box is not a
   * layout, it is a hole.
   */
  if (!stats) return <Screen>{null}</Screen>;

  const [weekVolume, weekVolumeUnit] = splitMeasure(
    formatVolume(stats.thisWeekVolumeKg, weightUnit),
  );

  const volumeData = weekly.map((point) => ({ x: point.weekStart, y: point.volumeKg }));
  const distributionData: BarDatum[] = distribution.map((entry) => ({
    label: BODY_PART_LABELS[entry.bodyPart] ?? entry.bodyPart,
    value: entry.sets,
  }));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/*
         * Four blocks, revealed in the order they are read.
         *
         * Everything below this point is gated on `stats`, so none of it exists
         * until the aggregates land — and they now land deliberately late, held
         * behind the tab transition by `useDeferredFocusEffect`. Without the
         * `Reveal`s that arrival is a pop: an empty canvas one frame, a full
         * dashboard the next. With them it is the screen resolving, which is
         * the same delay described honestly.
         *
         * The stagger is per *block*, not per element. The masthead and the
         * band are one thought — this week, in a word and then in figures — so
         * they arrive together; each chart is its own, and the recent list is
         * last because it is the one thing here you can act on.
         */}
        <Reveal index={0}>
          {/*
           * One block where there were two.
           *
           * This screen used to open with a row of three tiles — streak,
           * workouts, active days — and then, immediately below, a card headed
           * "This week" carrying workouts and volume. Two stat blocks stacked,
           * with "workouts" appearing in both at two different scopes and no
           * indication of which was which. Home now answers exactly one
           * question — how is this week going — and the lifetime totals live on
           * Profile, where "lifetime" is the whole point.
           *
           * The figure is plain text and the kicker above it carries the accent,
           * which is the opposite of the obvious pairing. In the light palette
           * the accent is a dark olive chosen to be legible as text, so
           * accenting the number made the loudest thing on the screen quieter
           * than the label under it. Colouring the small word instead holds in
           * both schemes with no branching on the colour scheme — do not swap
           * these back.
           *
           * `heading` rather than `display`: the figure came down from 40px to
           * 24 along with every other statistic in the app. A number that fills
           * the width of a phone reads as a scoreboard, and this one is context
           * for the week rather than a score — the kicker names it, the band
           * below breaks it down, and the charts under that are what a training
           * log is actually for. It still opens the screen; it no longer shouts.
           */}
          <View style={styles.masthead}>
            <Text variant="overline" color="accent">
              Volume this week
            </Text>
            <Text variant="heading" color="text" numberOfLines={1} adjustsFontSizeToFit>
              {weekVolume}
              {weekVolumeUnit ? (
                <Text variant="label" color="textTertiary">
                  {` ${weekVolumeUnit}`}
                </Text>
              ) : null}
            </Text>
          </View>

          <StatBand
            style={styles.band}
            items={[
              { label: 'Sessions', value: String(stats.thisWeekWorkouts) },
              { label: 'Week streak', value: String(stats.weekStreak) },
            ]}
          />
        </Reveal>

        {/*
         * The charts are not boxed.
         *
         * They used to sit in Cards, which pushed them to x=32 while the
         * masthead, the stat band and the section headers all sat at x=16 —
         * the one place on the screen where the grid broke, and it broke around
         * the two elements least able to spare the width. Unboxed, the screen
         * states a rule you can say out loud: boxed means you can touch it. The
         * recent-workouts list below keeps its Card because its rows are taps.
         */}
        <Reveal index={1}>
          <SectionHeader title="Volume · last 12 weeks" />
          <View style={styles.chart}>
            <LineChart
              data={volumeData}
              width={chartWidth}
              formatValue={(value) => formatVolume(value, weightUnit).replace(` ${weightUnit}`, '')}
              formatLabel={(x) =>
                new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
              }
            />
          </View>
        </Reveal>

        <Reveal index={2}>
          <SectionHeader title="Sets by body part · 30 days" />
          <View style={styles.chart}>
            <BarChart data={distributionData} formatValue={(value) => `${Math.round(value)}`} />
          </View>
        </Reveal>

        {recent.length > 0 ? (
          <Reveal index={3}>
            <SectionHeader
              title="Recent workouts"
              action={
                <Button
                  title="History"
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push('/history')}
                />
              }
            />
            <Card padded={false} style={styles.recentCard}>
              {recent.map((workout, index) => (
                <View key={workout.id}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <ListRow
                    title={workout.name}
                    subtitle={`${workout.startedAt.toLocaleDateString()} · ${formatDurationShort(
                      workout.durationSeconds ?? 0,
                    )} · ${formatVolume(workout.totalVolumeKg, weightUnit)}`}
                    onPress={() =>
                      router.push({ pathname: '/workout/[id]', params: { id: workout.id } })
                    }
                  />
                </View>
              ))}
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  band: { marginHorizontal: spacing.lg },
  chart: { marginHorizontal: spacing.lg },
  recentCard: { marginHorizontal: spacing.lg },
});
