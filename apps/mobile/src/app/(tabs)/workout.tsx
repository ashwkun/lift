import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@lift/shared';
import { and, asc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  ListRow,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
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
            style={({ pressed }) => [
              styles.resume,
              {
                backgroundColor: colors.accentSurface,
                borderColor: colors.accent,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.resumeBody}>
              <Text variant="overline" color="accent">
                In progress
              </Text>
              <Text variant="bodyMedium" numberOfLines={1}>
                {active.name}
              </Text>
              <Text variant="numericLarge" color="accent">
                {formatDuration(Math.floor((now - active.startedAt.getTime()) / 1000))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.accent} />
          </Pressable>
        )}

        <View style={styles.quickStart}>
          <Button
            title={active ? 'Resume Workout' : 'Start Empty Workout'}
            icon={active ? 'play' : 'add'}
            size="lg"
            fullWidth
            onPress={() => (active ? router.push('/workout/active') : void beginEmpty())}
          />
        </View>

        <SectionHeader
          title="Routines"
          action={
            <Button
              title="New"
              icon="add"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/routine/new')}
            />
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
          <Card padded={false} style={styles.routineCard}>
            {routines.map((routine, index) => (
              <View key={routine.id}>
                {index > 0 && <Divider inset={spacing.lg} />}
                <ListRow
                  title={routine.name}
                  subtitle={
                    routine.lastPerformedAt
                      ? `Last performed ${routine.lastPerformedAt.toLocaleDateString()}`
                      : 'Not performed yet'
                  }
                  icon="list"
                  tone="accent"
                  onPress={() =>
                    router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                  }
                  // Start is the action people come to this row for, so it gets
                  // its own target instead of hiding behind a tap-through to the
                  // detail screen.
                  accessory={
                    <Button
                      title="Start"
                      size="sm"
                      variant="secondary"
                      onPress={() => void beginFromRoutine(routine.id)}
                    />
                  }
                />
              </View>
            ))}
          </Card>
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
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  resumeBody: { flex: 1, gap: 2 },
  quickStart: { padding: spacing.lg },
  routineCard: { marginHorizontal: spacing.lg },
});
