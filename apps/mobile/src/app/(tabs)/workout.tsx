import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@ironlog/shared';
import { and, asc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Screen, SectionHeader, Text } from '@/components/ui';
import { db } from '@/db/client';
import { routines as routinesTable, workouts } from '@/db/schema';
import { startWorkout } from '@/features/workouts/repository';
import { useTicker } from '@/hooks/use-ticker';
import { radius, spacing, useColors } from '@/theme';

export default function WorkoutScreen() {
  const colors = useColors();

  const { data: activeRows = [] } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt))),
  );

  const { data: routines = [] } = useLiveQuery(
    db
      .select()
      .from(routinesTable)
      .where(isNull(routinesTable.deletedAt))
      .orderBy(asc(routinesTable.position)),
  );

  const active = activeRows[0];
  const now = useTicker(1000, Boolean(active));

  const beginEmpty = async () => {
    const workout = await startWorkout();
    router.push({ pathname: '/workout/active', params: { id: workout.id } });
  };

  const beginFromRoutine = async (routineId: string) => {
    const workout = await startWorkout({ routineId });
    router.push({ pathname: '/workout/active', params: { id: workout.id } });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {active && (
          <Pressable
            onPress={() => router.push('/workout/active')}
            style={[styles.resume, { backgroundColor: colors.accentSurface, borderColor: colors.accent }]}
          >
            <View style={styles.resumeBody}>
              <Text variant="caption" color="accent">
                IN PROGRESS
              </Text>
              <Text variant="bodyMedium">{active.name}</Text>
              <Text variant="numeric" color="accent">
                {formatDuration(Math.floor((now - active.startedAt.getTime()) / 1000))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.accent} />
          </Pressable>
        )}

        <View style={styles.quickStart}>
          <Text variant="overline" color="textSecondary">
            QUICK START
          </Text>
          <Button
            title={active ? 'Resume Workout' : 'Start Empty Workout'}
            icon="add"
            size="lg"
            fullWidth
            onPress={() =>
              active ? router.push('/workout/active') : void beginEmpty()
            }
          />
        </View>

        <SectionHeader
          title="Routines"
          action={
            <Pressable onPress={() => router.push('/routine/new')} hitSlop={8}>
              <Text variant="label" color="accent">
                New Routine
              </Text>
            </Pressable>
          }
        />

        {routines.length === 0 ? (
          <EmptyState
            icon="list-outline"
            title="No routines yet"
            description="Build a routine to start workouts with your exercises and target sets already filled in."
            action={<Button title="Create Routine" onPress={() => router.push('/routine/new')} />}
          />
        ) : (
          <View style={styles.routineList}>
            {routines.map((routine) => (
              <Card key={routine.id} style={styles.routineCard}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                  }
                >
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {routine.name}
                  </Text>
                  {routine.lastPerformedAt && (
                    <Text variant="caption" color="textTertiary">
                      Last performed {routine.lastPerformedAt.toLocaleDateString()}
                    </Text>
                  )}
                </Pressable>
                <Button
                  title="Start Routine"
                  size="sm"
                  fullWidth
                  onPress={() => void beginFromRoutine(routine.id)}
                  style={styles.routineButton}
                />
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resumeBody: { gap: 2 },
  quickStart: { padding: spacing.lg, gap: spacing.sm },
  routineList: { paddingHorizontal: spacing.lg, gap: spacing.md },
  routineCard: { gap: spacing.md },
  routineButton: { marginTop: spacing.xs },
});
