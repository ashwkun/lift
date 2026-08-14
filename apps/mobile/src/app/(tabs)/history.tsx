import { Ionicons } from '@expo/vector-icons';
import { formatDurationShort, formatVolume } from '@ironlog/shared';
import { and, desc, isNotNull, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { Button, EmptyState, Screen, Text } from '@/components/ui';
import { db } from '@/db/client';
import { workouts, type Workout } from '@/db/schema';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

interface MonthSection {
  title: string;
  /** Sort key, so December 2025 doesn't land next to December 2026. */
  key: string;
  data: Workout[];
}

export default function HistoryScreen() {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const { data: completed = [] } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt)),
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

  const totals = useMemo(() => {
    const volume = completed.reduce((sum, workout) => sum + workout.totalVolumeKg, 0);
    return { count: completed.length, volume };
  }, [completed]);

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

  return (
    <Screen>
      <View style={[styles.summary, { borderBottomColor: colors.border }]}>
        <View>
          <Text variant="caption" color="textTertiary">
            WORKOUTS
          </Text>
          <Text variant="numeric">{totals.count}</Text>
        </View>
        <View>
          <Text variant="caption" color="textTertiary">
            TOTAL VOLUME
          </Text>
          <Text variant="numeric">{formatVolume(totals.volume, weightUnit)}</Text>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <WorkoutCard workout={item} weightUnit={weightUnit} />
        )}
      />
    </Screen>
  );
}

function WorkoutCard({ workout, weightUnit }: { workout: Workout; weightUnit: 'kg' | 'lb' }) {
  const colors = useColors();

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardHeader}>
        <Text variant="bodyMedium" numberOfLines={1} style={styles.cardTitle}>
          {workout.name}
        </Text>
        {workout.prCount > 0 && (
          <View style={[styles.prBadge, { backgroundColor: colors.recordSurface }]}>
            <Ionicons name="trophy" size={11} color={colors.record} />
            <Text variant="caption" color="record">
              {workout.prCount}
            </Text>
          </View>
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
    </Pressable>
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
  summary: {
    flexDirection: 'row',
    gap: spacing.huge,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  sectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { flex: 1 },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  metrics: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  metric: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
