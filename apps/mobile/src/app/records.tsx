import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationShort,
  formatVolume,
  formatWeight,
  PR_KIND_LABELS,
  type PrKind,
} from '@lift/shared';
import { desc, eq, isNull } from 'drizzle-orm';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, EmptyState, Screen, Text } from '@/components/ui';
import { db } from '@/db/client';
import { exercises, personalRecords } from '@/db/schema';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

interface ExerciseRecords {
  exerciseId: string;
  exerciseName: string;
  records: { kind: PrKind; value: number; achievedAt: Date }[];
}

export default function RecordsScreen() {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);
  const [grouped, setGrouped] = useState<ExerciseRecords[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const rows = await db
          .select({
            exerciseId: personalRecords.exerciseId,
            exerciseName: exercises.name,
            kind: personalRecords.kind,
            value: personalRecords.value,
            achievedAt: personalRecords.achievedAt,
          })
          .from(personalRecords)
          .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
          .where(isNull(personalRecords.deletedAt))
          .orderBy(desc(personalRecords.achievedAt));

        // Keep only the best entry per (exercise, kind).
        const byExercise = new Map<string, ExerciseRecords>();
        const seen = new Map<string, number>();

        for (const row of rows) {
          const key = `${row.exerciseId}:${row.kind}`;
          if ((seen.get(key) ?? 0) >= row.value) continue;
          seen.set(key, row.value);

          let entry = byExercise.get(row.exerciseId);
          if (!entry) {
            entry = { exerciseId: row.exerciseId, exerciseName: row.exerciseName, records: [] };
            byExercise.set(row.exerciseId, entry);
          }

          const existing = entry.records.findIndex((record) => record.kind === row.kind);
          const next = { kind: row.kind, value: row.value, achievedAt: row.achievedAt };
          if (existing >= 0) entry.records[existing] = next;
          else entry.records.push(next);
        }

        if (!cancelled) {
          setGrouped(
            [...byExercise.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName)),
          );
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (grouped.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Personal Records' }} />
        <EmptyState
          icon="trophy-outline"
          title="No records yet"
          description="Finish a workout and your first personal records will appear here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Personal Records' }} />

      <ScrollView contentContainerStyle={styles.content}>
        {grouped.map((entry) => (
          <Card key={entry.exerciseId} style={styles.card}>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/exercise/[id]', params: { id: entry.exerciseId } })
              }
              style={styles.header}
            >
              <Ionicons name="trophy" size={15} color={colors.record} />
              <Text variant="bodyMedium" numberOfLines={1} style={styles.flex}>
                {entry.exerciseName}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>

            {entry.records.map((record) => (
              <View key={record.kind} style={styles.row}>
                <Text variant="label" color="textSecondary" style={styles.flex}>
                  {PR_KIND_LABELS[record.kind]}
                </Text>
                <Text variant="numeric" color="record">
                  {formatRecord(record.kind, record.value, weightUnit)}
                </Text>
              </View>
            ))}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

function formatRecord(kind: PrKind, value: number, unit: 'kg' | 'lb'): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      return `${value.toFixed(2)} km`;
    case 'best_set_volume':
    case 'best_session_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
