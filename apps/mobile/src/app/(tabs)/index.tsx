import { formatDurationShort, formatVolume } from '@lift/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ListRow,
  Screen,
  SectionHeader,
  StatTile,
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
  useFocusEffect(
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

  // Screen width less the card's outer margin and its inner padding.
  const chartWidth = width - spacing.lg * 4;

  if (stats && stats.totalWorkouts === 0) {
    return (
      <Screen>
        <EmptyState
          icon="flame-outline"
          title="Let's get started"
          description="Log your first workout and your stats, records and progress charts will build from there."
          action={<Button title="Start a Workout" onPress={() => router.push('/(tabs)/workout')} />}
        />
      </Screen>
    );
  }

  const volumeData = weekly.map((point) => ({ x: point.weekStart, y: point.volumeKg }));
  const distributionData: BarDatum[] = distribution.map((entry) => ({
    label: BODY_PART_LABELS[entry.bodyPart] ?? entry.bodyPart,
    value: entry.sets,
  }));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statRow}>
          <StatTile
            icon="flame"
            label="Week streak"
            value={String(stats?.weekStreak ?? 0)}
            tone="warning"
          />
          <StatTile
            icon="barbell"
            label="Workouts"
            value={String(stats?.totalWorkouts ?? 0)}
            tone="accent"
          />
          <StatTile
            icon="calendar"
            label="Active days"
            value={String(stats?.activeDays ?? 0)}
            tone="success"
          />
        </View>

        <SectionHeader title="This week" />
        <Card style={styles.weekCard}>
          <View style={styles.weekStat}>
            <Text variant="overline" color="textTertiary">
              Workouts
            </Text>
            <Text variant="numericLarge">{stats?.thisWeekWorkouts ?? 0}</Text>
          </View>
          <Divider style={styles.weekDivider} />
          <View style={styles.weekStat}>
            <Text variant="overline" color="textTertiary">
              Volume
            </Text>
            <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
              {formatVolume(stats?.thisWeekVolumeKg ?? 0, weightUnit)}
            </Text>
          </View>
        </Card>

        <SectionHeader title="Volume · Last 12 weeks" />
        <Card style={styles.chartCard}>
          <LineChart
            data={volumeData}
            width={chartWidth}
            formatValue={(value) => formatVolume(value, weightUnit).replace(` ${weightUnit}`, '')}
            formatLabel={(x) =>
              new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            }
          />
        </Card>

        <SectionHeader title="Sets by body part · 30 days" />
        <Card style={styles.chartCard}>
          <BarChart data={distributionData} formatValue={(value) => `${Math.round(value)}`} />
        </Card>

        <SectionHeader
          title="Recent workouts"
          action={
            <Button
              title="See all"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/(tabs)/history')}
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
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  weekCard: {
    marginHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekStat: { flex: 1, alignItems: 'center', gap: spacing.xs },
  // A vertical rule between the two figures, so they read as two measurements
  // rather than one wrapped number. `alignSelf: stretch` overrides the card's
  // `alignItems: center` to give the rule the full content height.
  weekDivider: { width: StyleSheet.hairlineWidth, height: undefined, alignSelf: 'stretch' },
  chartCard: { marginHorizontal: spacing.lg },
  recentCard: { marginHorizontal: spacing.lg },
});
