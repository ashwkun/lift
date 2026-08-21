import { Ionicons } from '@expo/vector-icons';
import {
  DATE_SHORT,
  formatDateTime,
  formatDurationShort,
  formatVolume,
  type WeightUnit,
} from '@lift/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { fontSize, spacing, useColors } from '@/theme';

/**
 * What a card reads off a session.
 *
 * Structural rather than the `Workout` row type, so a screen that selected only
 * the columns it needed — the calendar loads seven of them for the whole log —
 * can render the same card without carrying the sync bookkeeping around with it.
 */
export interface WorkoutCardSummary {
  id: string;
  name: string;
  startedAt: Date;
  durationSeconds: number | null;
  totalVolumeKg: number;
  totalSets: number;
  prCount: number;
}

export interface WorkoutCardProps {
  workout: WorkoutCardSummary;
  weightUnit: WeightUnit;
  /**
   * The line under the title. Defaults to the date.
   *
   * Overridden by the calendar's day panel, where the heading above the list is
   * already the date and repeating it in every row would say nothing — it
   * passes the time of day instead, which is the one thing that separates two
   * sessions on the same square.
   */
  detail?: string;
}

/**
 * One finished session: name, when, and its three figures.
 *
 * Lives here rather than in the history screen because the calendar lists the
 * same sessions and a second copy would drift — the two screens are the only
 * places in the app that put workouts in a list.
 */
export function WorkoutCard({ workout, weightUnit, detail }: WorkoutCardProps) {
  return (
    <Card
      style={styles.card}
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id } })}
    >
      <View style={styles.header}>
        <Text variant="bodyMedium" numberOfLines={1} style={styles.title}>
          {workout.name}
        </Text>
        {workout.prCount > 0 && (
          <Badge
            tone="record"
            icon="trophy"
            label={workout.prCount === 1 ? '1 PR' : `${workout.prCount} PRs`}
          />
        )}
      </View>

      {/* Date and clock. This line used to be the date alone, on the argument
          that nobody scans a training log by the hour — but the hour is how you
          tell two sessions on the same day apart, and how you recognise the one
          you are looking for ("the early one, before work"). It costs the
          session name nothing: the name is on its own line above. */}
      <Text variant="caption" color="textTertiary">
        {detail ?? formatDateTime(workout.startedAt, DATE_SHORT)}
      </Text>

      <View style={styles.metrics}>
        <Metric icon="time-outline" value={formatDurationShort(workout.durationSeconds ?? 0)} />
        <Metric icon="barbell-outline" value={formatVolume(workout.totalVolumeKg, weightUnit)} />
        <Metric icon="layers-outline" value={`${workout.totalSets} sets`} />
      </View>
    </Card>
  );
}

/**
 * One figure from a session, with its kind carried by the icon.
 *
 * `numeric` rather than `label`: these three columns are read down the list, so
 * they carry the numeric variant's weight and its tabular figures. Read down a
 * list, "48:12" and "1:05:30" have to put their colons in the same place, or
 * the column visibly jitters as you scroll.
 */
function Metric({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={13} color={colors.textTertiary} />
      <Text variant="numeric" color="textSecondary" style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  metrics: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  metric: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // `numeric` for the tabular figures, stepped back down to the label size it
  // replaced: at its own 15px semibold these three secondary numbers would sit
  // heavier than the session name above them.
  metricValue: { fontSize: fontSize.sm },
});
