import { Ionicons } from '@expo/vector-icons';
import { formatVolume } from '@ironlog/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Divider, Screen, SectionHeader, Text } from '@/components/ui';
import { getDashboardStats, type DashboardStats } from '@/features/analytics/repository';
import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { and, isNotNull, isNull } from 'drizzle-orm';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

export default function ProfileScreen() {
  const colors = useColors();
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
        <Card style={styles.statsCard}>
          <Stat label="Workouts" value={String(stats?.totalWorkouts ?? 0)} />
          <Stat label="Week Streak" value={String(stats?.weekStreak ?? 0)} />
          <Stat label="Volume" value={formatVolume(lifetimeVolume, weightUnit)} />
        </Card>

        <SectionHeader title="Tracking" />
        <Card padded={false}>
          <NavRow
            icon="body-outline"
            label="Body Measurements"
            onPress={() => router.push('/measurements')}
          />
          <Divider inset={52} />
          <NavRow
            icon="trophy-outline"
            label="Personal Records"
            onPress={() => router.push('/records')}
          />
          <Divider inset={52} />
          <NavRow
            icon="calculator-outline"
            label="Plate Calculator"
            onPress={() => router.push('/plate-calculator')}
          />
        </Card>

        <SectionHeader title="App" />
        <Card padded={false}>
          <NavRow icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
          <Divider inset={52} />
          <NavRow
            icon="cloud-upload-outline"
            label="Backup & Export"
            onPress={() => router.push('/export')}
          />
        </Card>

        <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
          IronLog · all data stored on this device
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="numeric">{value}</Text>
      <Text variant="caption" color="textTertiary">
        {label}
      </Text>
    </View>
  );
}

function NavRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text variant="body" style={styles.navLabel}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  statsCard: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: spacing.xs },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
  },
  navLabel: { flex: 1 },
  footer: { marginTop: spacing.xl },
});
