import { formatVolume } from '@lift/shared';
import { and, isNotNull, isNull } from 'drizzle-orm';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, Divider, ListRow, Screen, SectionHeader, StatTile, Text } from '@/components/ui';
import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { getDashboardStats, type DashboardStats } from '@/features/analytics/repository';
import { SyncCard } from '@/features/sync/sync-card';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

export default function ProfileScreen() {
  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lifetimeVolume, setLifetimeVolume] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getDashboardStats();

        const rows = await db
          .select({ totalVolumeKg: workouts.totalVolumeKg })
          .from(workouts)
          .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)));

        if (cancelled) return;
        setStats(next);
        setLifetimeVolume(rows.reduce((sum, row) => sum + row.totalVolumeKg, 0));
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Same tile row as the home screen, so the two lifetime figures and the
            weekly ones are visibly the same kind of thing. */}
        <View style={styles.statRow}>
          <StatTile
            icon="barbell"
            label="Workouts"
            value={String(stats?.totalWorkouts ?? 0)}
            tone="accent"
          />
          <StatTile
            icon="flame"
            label="Week streak"
            value={String(stats?.weekStreak ?? 0)}
            tone="warning"
          />
          <StatTile
            icon="trending-up"
            label="Volume"
            value={formatVolume(lifetimeVolume, weightUnit)}
            tone="success"
          />
        </View>

        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SyncCard />
        </View>

        <SectionHeader title="Tracking" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="body-outline"
            title="Body Measurements"
            onPress={() => router.push('/measurements')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="trophy-outline"
            tone="record"
            title="Personal Records"
            onPress={() => router.push('/records')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="calculator-outline"
            title="Plate Calculator"
            onPress={() => router.push('/plate-calculator')}
          />
        </Card>

        <SectionHeader title="App" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="settings-outline"
            title="Settings"
            onPress={() => router.push('/settings')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="cloud-upload-outline"
            title="Backup & Export"
            onPress={() => router.push('/export')}
          />
        </Card>

        <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
          Lift · all data stored on this device
        </Text>
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
  section: { marginHorizontal: spacing.lg },
  footer: { marginTop: spacing.xxl },
});
