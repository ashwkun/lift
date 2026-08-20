import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@lift/shared';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
import { useRows } from '@/db/use-rows';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useTicker } from '@/hooks/use-ticker';
import { radius, spacing, stroke, useColors } from '@/theme';

/** Latch key for the ad-hoc Start, which has no routine id to be keyed by. */
const EMPTY_START = 'empty';

export default function WorkoutScreen() {
  const colors = useColors();

  // Newest first and capped at one: two open sessions should be impossible, but
  // an unordered query made "the active workout" whichever row SQLite handed
  // back first, which is not a promise SQLite makes.
  const { rows: activeRows, loaded: activeLoaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
  );

  const { rows: routines, loaded: routinesLoaded } = useRows(
    db
      .select()
      .from(routinesTable)
      .where(isNull(routinesTable.deletedAt))
      .orderBy(asc(routinesTable.position)),
  );

  const active = activeRows[0];
  const now = useTicker(1000, Boolean(active));

  // Which Start control is mid-flight, or null. Session creation is a round
  // trip to disk, so an unlatched second tap would ask for a second session and
  // the loser of that race would fail silently. Held as an id rather than a
  // boolean so only the control that was pressed shows the spinner.
  const [starting, setStarting] = useState<string | null>(null);
  // The latch itself is a ref, not the state above: two taps inside one frame
  // would both read the pre-render state and both get through.
  const inFlight = useRef(false);

  const openActive = () => router.push('/workout/active');

  const begin = async (routineId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(routineId ?? EMPTY_START);

    try {
      const outcome = await startSession({
        create: () => startWorkout(routineId ? { routineId } : {}),
        // An open session started from the same routine — or an open ad-hoc
        // session when the tap was "start empty" — is the thing being asked
        // for. Going through is a resume, not a second session.
        resumes: (open) => open.routineId === (routineId ?? null),
        openExisting: openActive,
      });

      if (outcome === 'started' || outcome === 'resumed') openActive();
    } finally {
      inFlight.current = false;
      setStarting(null);
    }
  };

  /*
   * Both queries seed `[]` and answer a tick later, and this tab is where a
   * cold start lands. Without the gate the routine list opens on "No routines
   * yet" for a user who has routines, and `active` is briefly undefined — so
   * the resume card is missing, the button offers to start a second session,
   * and a tap inside that window reaches `begin` with `resumes` false, which
   * silently discards the open workout.
   */
  if (!activeLoaded || !routinesLoaded) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {active && (
          <Pressable
            onPress={openActive}
            accessibilityRole="button"
            // The label replaces the merged child text, which is the point: the
            // clock inside this card reads a second later on every frame, so an
            // announcement built from the children would never settle.
            accessibilityLabel={`Resume ${active.name}`}
            accessibilityHint="Opens the workout in progress"
            style={({ pressed }) => [
              styles.resume,
              {
                backgroundColor: colors.accentSurface,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.resumeBody}>
              {/* The tint and the running clock are one accent object; the
                  kicker, the border and the chevron are reinforcements that
                  only spread the accent thinner. */}
              <Text variant="overline" color="textSecondary">
                In progress
              </Text>
              <Text variant="bodyMedium" numberOfLines={1}>
                {active.name}
              </Text>
              <Text variant="numericLarge" color="accent">
                {formatDuration(Math.floor((now - active.startedAt.getTime()) / 1000))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textTertiary} />
          </Pressable>
        )}

        <View style={styles.quickStart}>
          <Button
            title={active ? 'Resume workout' : 'Start empty workout'}
            icon={active ? 'play' : 'add'}
            size="lg"
            fullWidth
            loading={starting === EMPTY_START}
            onPress={() => (active ? openActive() : void begin())}
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
            action={<Button title="Create routine" onPress={() => router.push('/routine/new')} />}
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
                  onPress={() =>
                    router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                  }
                  // Start is the action people come to this row for, so it gets
                  // its own target instead of hiding behind a tap-through to the
                  // detail screen. The row swallows it for a screen reader,
                  // hence the matching custom action.
                  accessibilityActions={[
                    {
                      name: 'start',
                      label: active?.routineId === routine.id ? 'Resume' : 'Start',
                    },
                  ]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'start') void begin(routine.id);
                  }}
                  accessory={
                    <Button
                      // The button says what the tap will actually do: with
                      // this routine's session already open, going through is a
                      // resume, and the old label promised a fresh session it
                      // was never going to create.
                      title={active?.routineId === routine.id ? 'Resume' : 'Start'}
                      size="sm"
                      variant="secondary"
                      loading={starting === routine.id}
                      onPress={() => void begin(routine.id)}
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
    borderWidth: stroke.outline,
  },
  resumeBody: { flex: 1, gap: 2 },
  quickStart: { padding: spacing.lg },
  routineCard: { marginHorizontal: spacing.lg },
});
