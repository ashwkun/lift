import { Ionicons } from '@expo/vector-icons';
import { formatDurationShort, formatVolume } from '@ironlog/shared';
import { useFocusEffect } from 'expo-router';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Button, Card, EmptyState, Screen, SectionHeader, Text } from '@/components/ui';
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
import { radius, spacing, useColors } from '@/theme';

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
  const colors = useColors();
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

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;

  if (stats && stats.totalWorkouts === 0) {
    return (
      <Screen>
        <EmptyState
          icon="flame-outline"
          title="Let's get started"
          description="Log your first workout and your stats, records and progress charts will build from there."
          action={
            <Button title="Start a Workout" onPress={() => router.push('/(tabs)/workout')} />
          }
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
            label="Week Streak"
            value={String(stats?.weekStreak ?? 0)}
            tint={colors.warning}
          />
          <StatTile
            icon="barbell"
            label="Workouts"
            value={String(stats?.totalWorkouts ?? 0)}
            tint={colors.accent}
          />
          <StatTile
            icon="calendar"
            label="Active Days"
            value={String(stats?.activeDays ?? 0)}
            tint={colors.success}
          />
        </View>

        <SectionHeader title="This Week" />
        <Card style={styles.weekCard}>
          <View style={styles.weekStat}>
            <Text variant="caption" color="textTertiary">
              WORKOUTS
            </Text>
            <Text variant="numericLarge">{stats?.thisWeekWorkouts ?? 0}</Text>
          </View>
          <View style={styles.weekStat}>
            <Text variant="caption" color="textTertiary">
              VOLUME
            </Text>
            <Text variant="numericLarge">
              {formatVolume(stats?.thisWeekVolumeKg ?? 0, weightUnit)}
            </Text>
          </View>
        </Card>

        <SectionHeader title="Volume · Last 12 Weeks" />
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

        <SectionHeader title="Sets by Body Part · 30 Days" />
        <Card style={styles.chartCard}>
          <BarChart data={distributionData} formatValue={(value) => `${Math.round(value)}`} />
        </Card>

        <SectionHeader
          title="Recent Workouts"
          action={
            <Pressable onPress={() => router.push('/(tabs)/history')} hitSlop={8}>
              <Text variant="label" color="accent">
                See all
              </Text>
            </Pressable>
          }
        />
        <View style={styles.recentList}>
          {recent.map((workout) => (
            <Pressable
              key={workout.id}
              onPress={() =>
                router.push({ pathname: '/workout/[id]', params: { id: workout.id } })
              }
              style={[styles.recentRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.flex}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {workout.name}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {workout.startedAt.toLocaleDateString()} ·{' '}
                  {formatDurationShort(workout.durationSeconds ?? 0)} ·{' '}
                  {formatVolume(workout.totalVolumeKg, weightUnit)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function StatTile({
  icon,
  label,
  value,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tint: string;
}) {
  const colors = useColors();

  return (
    <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={tint} />
      <Text variant="numeric">{value}</Text>
      <Text variant="caption" color="textTertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  statRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  weekCard: { marginHorizontal: spacing.lg, flexDirection: 'row', justifyContent: 'space-around' },
  weekStat: { alignItems: 'center', gap: spacing.xs },
  chartCard: { marginHorizontal: spacing.lg },
  recentList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
