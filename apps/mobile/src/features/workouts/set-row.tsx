import { Ionicons } from '@expo/vector-icons';
import {
  formatDuration,
  fromDisplayWeight,
  parseDuration,
  SET_TYPE_BADGE,
  toDisplayWeight,
  TRACKING_FIELDS,
  type SetType,
  type TrackingType,
} from '@ironlog/shared';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { NumericField, Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

export interface SetRowProps {
  set: WorkoutSet;
  /** 1-based index among working sets; warm-ups show a badge instead. */
  workingIndex: number;
  trackingType: TrackingType;
  /** Same-position set from the previous session, shown as a ghost target. */
  previous?: WorkoutSet;
  onChange: (patch: Partial<WorkoutSet>) => void;
  onToggleComplete: () => void;
  onDelete: () => void;
  onChangeSetType: (setType: SetType) => void;
}

/** Formats the "previous" column, e.g. "100 kg × 5" or "—". */
function formatPrevious(
  previous: WorkoutSet | undefined,
  trackingType: TrackingType,
  unit: 'kg' | 'lb',
): string {
  if (!previous) return '—';

  const fields = TRACKING_FIELDS[trackingType];
  const parts: string[] = [];

  if (fields.weight && previous.weightKg != null) {
    parts.push(`${round(toDisplayWeight(previous.weightKg, unit))} ${unit}`);
  }
  if (fields.duration && previous.durationSeconds != null) {
    parts.push(formatDuration(previous.durationSeconds));
  }
  if (fields.distance && previous.distanceKm != null) {
    parts.push(`${round(previous.distanceKm)} km`);
  }
  if (fields.reps && previous.reps != null) {
    parts.push(parts.length > 0 ? `× ${previous.reps}` : `${previous.reps} reps`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const SetRow = memo(function SetRow({
  set,
  workingIndex,
  trackingType,
  previous,
  onChange,
  onToggleComplete,
  onDelete,
  onChangeSetType,
}: SetRowProps) {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const fields = TRACKING_FIELDS[trackingType];
  const badge = SET_TYPE_BADGE[set.setType];

  const badgeColor =
    set.setType === 'warmup'
      ? colors.warning
      : set.setType === 'drop'
        ? colors.accent
        : set.setType === 'failure'
          ? colors.danger
          : colors.textSecondary;

  const handleWeightChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      // Inputs are in the user's display unit; storage is always kilograms.
      onChange({ weightKg: parsed === null ? null : fromDisplayWeight(parsed, weightUnit) });
    },
    [onChange, weightUnit],
  );

  const handleRepsChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number.parseInt(text, 10);
      if (parsed !== null && !Number.isFinite(parsed)) return;
      onChange({ reps: parsed });
    },
    [onChange],
  );

  const handleDurationChange = useCallback(
    (text: string) => {
      onChange({ durationSeconds: text === '' ? null : parseDuration(text) });
    },
    [onChange],
  );

  const handleDistanceChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      onChange({ distanceKm: parsed });
    },
    [onChange],
  );

  const weightValue =
    set.weightKg == null ? '' : round(toDisplayWeight(set.weightKg, weightUnit));

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      renderRightActions={() => (
        <Pressable
          onPress={onDelete}
          accessibilityLabel="Delete set"
          style={[styles.deleteAction, { backgroundColor: colors.danger }]}
        >
          <Ionicons name="trash" size={20} color="#FFFFFF" />
        </Pressable>
      )}
    >
      <View
        style={[
          styles.row,
          {
            backgroundColor: set.isCompleted ? colors.accentSurface : 'transparent',
          },
        ]}
      >
        {/* Set number / type badge */}
        <Pressable
          onPress={() => onChangeSetType(nextSetType(set.setType))}
          accessibilityLabel={`Set type: ${set.setType}`}
          style={styles.indexCell}
        >
          <Text variant="numeric" style={{ color: badgeColor }}>
            {badge ?? workingIndex}
          </Text>
        </Pressable>

        {/* Previous session */}
        <Pressable
          style={styles.previousCell}
          disabled={!previous}
          onPress={() =>
            previous &&
            onChange({
              weightKg: previous.weightKg,
              reps: previous.reps,
              durationSeconds: previous.durationSeconds,
              distanceKm: previous.distanceKm,
            })
          }
        >
          <Text variant="label" color="textTertiary" numberOfLines={1}>
            {formatPrevious(previous, trackingType, weightUnit)}
          </Text>
        </Pressable>

        {fields.weight && (
          <NumericField
            value={weightValue}
            onChangeText={handleWeightChange}
            placeholder={
              previous?.weightKg != null
                ? round(toDisplayWeight(previous.weightKg, weightUnit))
                : '0'
            }
            style={styles.input}
          />
        )}

        {fields.duration && (
          <NumericField
            value={set.durationSeconds == null ? '' : formatDuration(set.durationSeconds)}
            onChangeText={handleDurationChange}
            keyboardType="numbers-and-punctuation"
            placeholder="0:00"
            style={styles.input}
          />
        )}

        {fields.distance && (
          <NumericField
            value={set.distanceKm == null ? '' : round(set.distanceKm)}
            onChangeText={handleDistanceChange}
            placeholder="0"
            style={styles.input}
          />
        )}

        {fields.reps && (
          <NumericField
            value={set.reps == null ? '' : String(set.reps)}
            onChangeText={handleRepsChange}
            keyboardType="number-pad"
            placeholder={previous?.reps != null ? String(previous.reps) : '0'}
            style={styles.input}
          />
        )}

        <Pressable
          onPress={onToggleComplete}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: set.isCompleted }}
          accessibilityLabel="Complete set"
          style={[
            styles.checkCell,
            {
              backgroundColor: set.isCompleted ? colors.success : colors.surfaceMuted,
            },
          ]}
        >
          <Ionicons
            name="checkmark"
            size={18}
            color={set.isCompleted ? '#FFFFFF' : colors.textTertiary}
          />
        </Pressable>
      </View>
    </ReanimatedSwipeable>
  );
});

/** Cycles set type on tap: normal → warm-up → drop → failure → normal. */
function nextSetType(current: SetType): SetType {
  const order: SetType[] = ['normal', 'warmup', 'drop', 'failure'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length]!;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  indexCell: { width: 32, alignItems: 'center' },
  previousCell: { flex: 1, minWidth: 60 },
  input: { flex: 0 },
  checkCell: {
    width: 38,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAction: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
