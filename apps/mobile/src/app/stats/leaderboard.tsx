import { Ionicons } from '@expo/vector-icons';
import {
  DATE_MEDIUM,
  EQUIPMENT_LABELS,
  formatDateTime,
  formatWeight,
  MUSCLE_GROUP_LABELS,
  type WeightUnit,
} from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Badge,
  Card,
  EmptyState,
  Screen,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { pluralSessions } from '@/features/analytics/format';
import {
  getLeaderboardExercises,
  LEADERBOARD_EQUIPMENT,
  LEADERBOARD_MIN_SESSIONS,
  type LeaderboardBoard,
  type LeaderboardExercise,
} from '@/features/analytics/exercise-stats';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

export default function LeaderboardScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);
  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);

  const [board, setBoard] = useState<LeaderboardBoard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getLeaderboardExercises({ bodyweightKg, formula }).catch(() => null);
        if (cancelled) return;
        setBoard(next);
        // A failed query still counts as loaded, the same rule `use-rows`
        // applies: a screen that never answers has to fall through to its
        // empty state rather than stay blank for the rest of the visit.
        setLoaded(true);
      })();

      return () => {
        cancelled = true;
      };
    }, [bodyweightKg, formula]),
  );

  if (!loaded) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Leaderboard exercises' }} />
      </Screen>
    );
  }

  const qualified = board?.qualified ?? [];
  const pending = board?.pending ?? [];

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Leaderboard exercises' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {qualified.length === 0 && pending.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="No qualifying lifts yet"
            description={`Log ${LEADERBOARD_MIN_SESSIONS} sessions of a barbell, dumbbell, kettlebell, Smith machine or weighted bodyweight exercise and it appears here with your best result.`}
          />
        ) : (
          <>
            {qualified.length > 0 && (
              <>
                <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
                  Your board
                </Text>

                <Card padded={false}>
                  {qualified.map((exercise, index) => (
                    <BoardRow
                      key={exercise.id}
                      exercise={exercise}
                      rank={index + 1}
                      weightUnit={weightUnit}
                    />
                  ))}
                </Card>
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
                  Not qualified yet
                </Text>

                <Card padded={false}>
                  {pending.map((exercise) => (
                    <BoardRow
                      key={exercise.id}
                      exercise={exercise}
                      rank={null}
                      weightUnit={weightUnit}
                    />
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {/*
          Offered rather than nagged about, and only where it would change what
          the screen shows: without a bodyweight on record the multiples are the
          one column that cannot be filled in, and the number is already asked
          for in Measurements.
        */}
        {board && !board.hasBodyweight && qualified.length > 0 && <BodyweightPrompt />}

        <Rules board={board} />
      </ScrollView>
    </Screen>
  );
}

function BodyweightPrompt() {
  const colors = useColors();

  return (
    <Card style={styles.prompt} onPress={() => router.push('/measurements')}>
      <View style={styles.promptHeader}>
        <Text variant="bodyMedium" style={styles.flex}>
          Log a bodyweight
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
      <Text variant="caption" color="textTertiary">
        Every result here would also read as a multiple of your bodyweight, which is the only way
        a 100 kg press and a 180 kg deadlift can be compared.
      </Text>
    </Card>
  );
}

function BoardRow({
  exercise,
  rank,
  weightUnit,
}: {
  exercise: LeaderboardExercise;
  rank: number | null;
  weightUnit: WeightUnit;
}) {
  const colors = useColors();

  const measure = formatWeight(exercise.bestOneRepMaxKg, weightUnit, { decimals: 1 });
  const [figure, unit] = splitMeasure(measure);
  const day = formatDateTime(new Date(exercise.achievedAt), DATE_MEDIUM);

  const working = `${formatWeight(exercise.bestSetWeightKg, weightUnit, { decimals: 1 })} × ${exercise.bestSetReps}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        rank ? `Number ${rank}` : null,
        exercise.name,
        `estimated one rep max ${measure}, from ${working} on ${day}`,
        exercise.bodyweightMultiple
          ? `${exercise.bodyweightMultiple.toFixed(2)} times bodyweight`
          : null,
        rank === null
          ? `${exercise.sessions} of ${LEADERBOARD_MIN_SESSIONS} sessions logged`
          : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      {rank !== null ? (
        <View style={[styles.rank, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="numeric" color="textSecondary" style={styles.rankLabel}>
            {rank}
          </Text>
        </View>
      ) : (
        <ExerciseThumbnail name={exercise.name} url={exercise.thumbnailUrl} size={34} />
      )}

      <View style={styles.body}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {exercise.name}
        </Text>

        {rank !== null ? (
          <>
            {/* The estimate with its working beside it. "142 kg, from 120 × 5"
                is a claim the reader can check; a bare 142 is one they have to
                take on trust — and an estimated max is exactly the figure that
                deserves the scrutiny. */}
            <Text variant="numeric" color="record" numberOfLines={1}>
              {figure}
              {unit ? <Text variant="caption" color="textTertiary">{` ${unit}`}</Text> : null}
              {exercise.bodyweightMultiple ? (
                <Text variant="caption" color="textTertiary">
                  {`  ·  ${exercise.bodyweightMultiple.toFixed(2)}× bodyweight`}
                </Text>
              ) : null}
            </Text>
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              from {working} · {day} · {pluralSessions(exercise.sessions)}
            </Text>
          </>
        ) : (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {exercise.sessions} of {LEADERBOARD_MIN_SESSIONS} sessions ·{' '}
            {MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} ·{' '}
            {EQUIPMENT_LABELS[exercise.equipment]}
          </Text>
        )}
      </View>

      {rank === null && (
        <Badge
          label={`${LEADERBOARD_MIN_SESSIONS - exercise.sessions} to go`}
          tone="neutral"
        />
      )}

      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

/**
 * What "eligible" means, written out.
 *
 * This screen filters most of the library away, and a list that silently omits
 * the leg press invites the reader to conclude the app lost it. The rules are
 * short enough to state, so they are stated.
 */
function Rules({ board }: { board: LeaderboardBoard | null }) {
  return (
    <Card style={styles.rules}>
      <Text variant="overline" color="textSecondary">
        What qualifies
      </Text>

      {/* The equipment list is read off the constant rather than written out,
          so the rule the screen states and the rule it applies cannot drift. */}
      <Text variant="caption" color="textTertiary">
        A lift makes this list when it is a library exercise — not one you created — loaded with{' '}
        {LEADERBOARD_EQUIPMENT.map((equipment) => EQUIPMENT_LABELS[equipment]).join(', ')}, tracked
        as weight for reps, and logged in at least {LEADERBOARD_MIN_SESSIONS} separate sessions.
      </Text>

      <Text variant="caption" color="textTertiary">
        Machines and cables are left off deliberately. Stack weights, lever arms and pulley ratios
        differ between manufacturers, so &ldquo;80&rdquo; on one leg press is not
        &ldquo;80&rdquo; on another — ranking those numbers measures the equipment rather than the
        lift.
      </Text>

      <Text variant="caption" color="textTertiary">
        Results are estimated one-rep maxes from your own completed sets, ranked against each
        other. Nothing here is uploaded and there is no one else on the board — this is your log,
        placed in order.
      </Text>

      {board && (
        <Text variant="caption" color="textTertiary">
          {board.eligibleInLibrary.toLocaleString()} exercises in the library are eligible.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  sectionHeader: { paddingTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: { flex: 1, gap: 2 },
  rank: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankLabel: { fontSize: 13 },
  prompt: { gap: spacing.xs },
  promptHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  rules: { gap: spacing.sm },
});
