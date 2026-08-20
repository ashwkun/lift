import { Ionicons } from '@expo/vector-icons';
import {
  formatDistance,
  formatDurationShort,
  formatWeight,
  isWorkingSet,
  SET_TYPE_BADGE,
  type DistanceUnit,
  type WeightUnit,
} from '@lift/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { radius, spacing, useColors } from '@/theme';

/**
 * The title sits directly above its column header with no padding of its own,
 * so the target is grown with slop: padding here would push every exercise name
 * away from the table it heads.
 */
const TITLE_SLOP = { top: 10, bottom: 10 };

const THUMBNAIL_SIZE = 40;

/** Width of the ordinal column, sized for "10" and for a "W"/"D"/"F" badge. */
const SET_COLUMN = 40;

export interface ExerciseSetListProps {
  name: string;
  sets: WorkoutSet[];
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  thumbnailUrl?: string | null;
  /**
   * Links the title through to the exercise's own screen. Omitted when the list
   * is already *on* that screen — a row that navigates to where you are is a
   * dead tap that still looks live.
   */
  exerciseId?: string;
  notes?: string | null;
  /** Sets that took a personal record, marked with a trophy. */
  recordSetIds?: ReadonlySet<string>;
}

/**
 * One exercise and its sets, set as a small table.
 *
 * This replaces a `Card` per exercise. A session is a stack of these, and a
 * stack of boxes is a stack of edges: twelve rounded outlines down a screen
 * whose actual content is two columns of figures. What reads instead is the
 * table — a round thumbnail and the name over a `SET / WEIGHT & REPS` header,
 * then the rows.
 *
 * Rows run the full width of the screen and stripe alternately, which is the
 * whole reason the card had to go. Zebra striping is what makes a long column
 * of numbers scannable without rules between every pair, and it only works if
 * the stripe reaches both edges — inset inside a card it reads as a highlighted
 * row rather than as the grain of a table. Callers must therefore give this
 * component a container with no horizontal padding; the rows carry the screen
 * margin themselves.
 */
export function ExerciseSetList({
  name,
  sets,
  weightUnit,
  distanceUnit,
  thumbnailUrl,
  exerciseId,
  notes,
  recordSetIds,
}: ExerciseSetListProps) {
  const colors = useColors();

  const heading = (
    <>
      {/* Round rather than the rounded square used in pickers and lists. In a
          picker the tile is one of a column of identical tiles and the square
          keeps the grid; here it is a single mark heading a table, and a circle
          reads as an avatar for the exercise rather than as a cropped photo. */}
      <ExerciseThumbnail
        name={name}
        url={thumbnailUrl}
        size={THUMBNAIL_SIZE}
        style={styles.thumbnail}
      />
      <Text variant="bodyMedium" numberOfLines={1} style={styles.flex}>
        {name}
      </Text>
      {exerciseId ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      ) : null}
    </>
  );

  return (
    <View style={styles.block}>
      {/* The chevron is what says the name is a link. Hevy paints every
          exercise name in its link blue; this app budgets the accent at roughly
          one element per view (`theme/tokens.ts`), and a session with twelve
          exercises would spend it twelve times before the user has read a
          single number. */}
      {exerciseId ? (
        <Pressable
          onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: exerciseId } })}
          hitSlop={TITLE_SLOP}
          accessibilityRole="link"
          accessibilityLabel={`${name}, view history and records`}
          style={styles.heading}
        >
          {heading}
        </Pressable>
      ) : (
        <View style={styles.heading}>{heading}</View>
      )}

      {notes ? (
        <Text variant="caption" color="textSecondary" style={styles.notes}>
          {notes}
        </Text>
      ) : null}

      <View style={styles.columnHeader}>
        <Text variant="overline" color="textTertiary" style={styles.setColumn}>
          Set
        </Text>
        <Text variant="overline" color="textTertiary">
          Weight &amp; reps
        </Text>
      </View>

      {sets.map((set, index) => (
        <View
          key={set.id}
          // Zebra, from `surface` rather than `surfaceMuted`. The muted step is
          // the app's input fill and reads as a control; one step off the canvas
          // is a stripe, which is all this has to be.
          style={[styles.setRow, index % 2 === 1 && { backgroundColor: colors.surface }]}
        >
          <Text variant="numeric" color="textSecondary" style={styles.setColumn}>
            {SET_TYPE_BADGE[set.setType] ?? countWorkingUpTo(sets, index)}
          </Text>
          <Text variant="numeric" style={styles.flex}>
            {describeSet(set, weightUnit, distanceUnit)}
          </Text>
          {recordSetIds?.has(set.id) && <Ionicons name="trophy" size={14} color={colors.record} />}
        </View>
      ))}
    </View>
  );
}

/**
 * The working-set ordinal of the row at `index` — warm-ups are skipped, so a
 * block of two warm-ups and three working sets numbers W, W, 1, 2, 3.
 *
 * Counted from the top on each row rather than carried in a mutable counter
 * across the map. The lists here are single digits long, and a counter mutated
 * inside a render callback is the kind of thing that survives right up until
 * something memoises a row.
 */
function countWorkingUpTo(sets: readonly WorkoutSet[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (isWorkingSet(sets[i]!.setType)) count += 1;
  }
  return count;
}

/**
 * "17.5 kg × 6", "45m", "5.2 km × 1".
 *
 * The load is whichever measure the set actually carries — a plank has seconds
 * and no weight, a row on the erg has distance — and reps are appended when
 * there are any. A set with none of the three prints an em dash rather than a
 * zero, because an untouched row is not a set of nothing.
 */
function describeSet(set: WorkoutSet, weightUnit: WeightUnit, distanceUnit: DistanceUnit): string {
  const load =
    set.weightKg != null
      ? formatWeight(set.weightKg, weightUnit, { decimals: 1 })
      : set.durationSeconds != null
        ? formatDurationShort(set.durationSeconds)
        : set.distanceKm != null
          ? formatDistance(set.distanceKm, distanceUnit)
          : '—';

  return set.reps != null ? `${load} × ${set.reps}` : load;
}

const styles = StyleSheet.create({
  block: { paddingBottom: spacing.sm },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  thumbnail: { borderRadius: radius.pill },
  notes: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  setColumn: { width: SET_COLUMN },
  flex: { flex: 1 },
});
