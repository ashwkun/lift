import { Ionicons } from '@expo/vector-icons';
import {
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatVolume,
  formatWeight,
  isWorkingSet,
  summarizeSets,
  type AnalyticsContext,
  type DistanceUnit,
  type SetLike,
  type SetSummary,
  type WeightUnit,
} from '@lift/shared';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { radius, spacing, useColors } from '@/theme';

export interface CelebrationStat {
  label: string;
  value: string;
}

/**
 * A finished exercise, already reduced to display strings.
 *
 * Formatting happens in `buildCelebration` rather than in the component so the
 * unit-dependent branching lives next to the tracking-type branching it belongs
 * with, and the component stays a pure renderer.
 */
export interface CelebrationData {
  /** Bumped per celebration; drives the entrance replay. */
  id: number;
  exerciseName: string;
  headline: { value: string; label: string };
  /** Change against the last session of the same exercise, when there was one. */
  delta: { text: string; improved: boolean } | null;
  stats: CelebrationStat[];
}

const AUTO_DISMISS_MS = 5000;

export interface ExerciseCelebrationProps {
  data: CelebrationData | null;
  onDismiss: () => void;
}

/**
 * The "exercise done" moment: a quiet card showing what was just achieved.
 *
 * No confetti here — that is reserved for finishing the whole workout. Firing it
 * per exercise spends the reward a dozen times a session, which leaves nothing
 * for the one moment that has actually earned it.
 *
 * Deliberately not a `Modal`. This fires mid-session, and a modal would block
 * the set rows behind it until dismissed — in an app whose whole point is
 * logging speed, that trades a two-second reward for a two-second interruption.
 * The overlay is `box-none`, so everything except the card itself stays live.
 */
export function ExerciseCelebration({ data, onDismiss }: ExerciseCelebrationProps) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!data) return;

    entrance.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.spring(entrance, {
        toValue: 1,
        damping: 13,
        stiffness: 180,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    }

    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [data, entrance, reduceMotion, onDismiss]);

  if (!data) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.centre} pointerEvents="box-none">
        <Animated.View
          style={{
            opacity: entrance,
            transform: [
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) },
              { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${data.exerciseName} complete. ${data.headline.value} ${data.headline.label}. Tap to dismiss.`}
            onPress={onDismiss}
            style={[
              styles.card,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.borderStrong },
            ]}
          >
            <View style={[styles.trophy, { backgroundColor: colors.recordSurface }]}>
              <Ionicons name="trophy" size={22} color={colors.record} />
            </View>

            <Text variant="overline" color="textTertiary">
              Exercise complete
            </Text>
            <Text variant="subheading" align="center" numberOfLines={2}>
              {data.exerciseName}
            </Text>

            <View style={styles.headline}>
              <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
                {data.headline.value}
              </Text>
              <Text variant="caption" color="textTertiary">
                {data.headline.label}
              </Text>
            </View>

            {data.delta && (
              <View
                style={[
                  styles.delta,
                  {
                    backgroundColor: data.delta.improved
                      ? colors.successSurface
                      : colors.surfaceMuted,
                  },
                ]}
              >
                <Ionicons
                  name={data.delta.improved ? 'trending-up' : 'remove'}
                  size={13}
                  color={data.delta.improved ? colors.success : colors.textSecondary}
                />
                <Text
                  variant="caption"
                  style={{ color: data.delta.improved ? colors.success : colors.textSecondary }}
                >
                  {data.delta.text}
                </Text>
              </View>
            )}

            <View style={[styles.stats, { borderTopColor: colors.border }]}>
              {data.stats.map((stat) => (
                <View key={stat.label} style={styles.stat}>
                  <Text variant="numeric" numberOfLines={1} adjustsFontSizeToFit>
                    {stat.value}
                  </Text>
                  <Text variant="caption" color="textTertiary" numberOfLines={1}>
                    {stat.label}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Building the payload
// ---------------------------------------------------------------------------

export interface BuildCelebrationOptions {
  id: number;
  exerciseName: string;
  /** Every set on the exercise, with the just-checked one already completed. */
  sets: readonly SetLike[];
  /** Completed sets from the previous session, for the comparison line. */
  previousSets: readonly SetLike[];
  ctx: AnalyticsContext;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}

/**
 * Reduces a finished exercise to the celebration's display model.
 *
 * Returns null when there is nothing worth celebrating — an exercise whose sets
 * are all warm-ups completes without ever producing a working set, and a card
 * for that would be noise.
 */
export function buildCelebration(options: BuildCelebrationOptions): CelebrationData | null {
  const { id, exerciseName, sets, previousSets, ctx, weightUnit, distanceUnit } = options;

  const summary = summarizeSets(sets, ctx);
  if (summary.workingSets === 0) return null;

  const previous = previousSets.length > 0 ? summarizeSets(previousSets, ctx) : null;
  const headline = headlineFor(summary, previous, ctx, weightUnit, distanceUnit);

  return {
    id,
    exerciseName,
    headline: { value: headline.value, label: headline.label },
    delta: buildDelta(headline.current, headline.previous),
    stats: statsFor(summary, sets, ctx, weightUnit, distanceUnit),
  };
}

interface Headline {
  value: string;
  label: string;
  current: number;
  previous: number | null;
}

/**
 * The one number that leads the card.
 *
 * Volume is meaningless for a plank and misleading for a run, so the headline
 * follows the tracking type — the same rule the set row uses to decide which
 * inputs to render.
 */
function headlineFor(
  summary: SetSummary,
  previous: SetSummary | null,
  ctx: AnalyticsContext,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): Headline {
  switch (ctx.trackingType) {
    case 'duration':
      return {
        value: formatDuration(summary.longestDurationSeconds),
        label: 'Longest hold',
        current: summary.longestDurationSeconds,
        previous: previous?.longestDurationSeconds ?? null,
      };
    case 'distance_duration':
      return {
        value: formatDistance(summary.farthestDistanceKm, distanceUnit),
        label: 'Farthest',
        current: summary.farthestDistanceKm,
        previous: previous?.farthestDistanceKm ?? null,
      };
    case 'reps_only':
      return {
        value: String(summary.totalReps),
        label: 'Total reps',
        current: summary.totalReps,
        previous: previous?.totalReps ?? null,
      };
    default:
      return {
        value: formatVolume(summary.volumeKg, weightUnit),
        label: 'Volume',
        current: summary.volumeKg,
        previous: previous?.volumeKg ?? null,
      };
  }
}

/**
 * The comparison chip.
 *
 * A drop is reported flatly rather than in a warning colour — the app should
 * not scold someone for a deload week, and volume legitimately falls on one.
 */
function buildDelta(current: number, previous: number | null) {
  if (previous === null || previous <= 0) return null;

  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) return { text: 'Same as last time', improved: false };

  const rounded = Math.round(Math.abs(change));
  return {
    text: `${change > 0 ? '+' : '−'}${rounded}% vs last time`,
    improved: change > 0,
  };
}

function statsFor(
  summary: SetSummary,
  sets: readonly SetLike[],
  ctx: AnalyticsContext,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): CelebrationStat[] {
  const stats: CelebrationStat[] = [{ label: 'Sets', value: String(summary.workingSets) }];

  switch (ctx.trackingType) {
    case 'duration': {
      const total = sets.reduce(
        (sum, set) =>
          set.isCompleted && isWorkingSet(set.setType) ? sum + (set.durationSeconds ?? 0) : sum,
        0,
      );
      stats.push({ label: 'Time under tension', value: formatDurationShort(total) });
      break;
    }
    case 'distance_duration': {
      const total = sets.reduce(
        (sum, set) =>
          set.isCompleted && isWorkingSet(set.setType) ? sum + (set.distanceKm ?? 0) : sum,
        0,
      );
      stats.push({ label: 'Distance', value: formatDistance(total, distanceUnit) });
      break;
    }
    case 'reps_only':
      stats.push({ label: 'Best set', value: `${summary.bestReps} reps` });
      break;
    default:
      stats.push({ label: 'Reps', value: String(summary.totalReps) });
      if (summary.heaviestKg > 0) {
        stats.push({
          label: 'Heaviest',
          value: formatWeight(summary.heaviestKg, weightUnit, { decimals: 1, withUnit: false }),
        });
      }
      if (summary.bestOneRepMaxKg > 0) {
        stats.push({
          label: 'Est. 1RM',
          value: formatWeight(summary.bestOneRepMaxKg, weightUnit, {
            decimals: 1,
            withUnit: false,
          }),
        });
      }
      break;
  }

  return stats;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 260,
    maxWidth: 340,
    // The overlay floats over a scroll view, so unlike the app's flat cards this
    // one needs real separation from whatever happens to be behind it.
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  trophy: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  headline: { alignItems: 'center', gap: 2, marginTop: spacing.sm },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
});
