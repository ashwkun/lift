import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@ironlog/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { cancelRestNotification, scheduleRestNotification } from '@/features/notifications/rest';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import { remainingRestSeconds, useTimer } from '@/store/timer';
import { radius, spacing, useColors } from '@/theme';

/**
 * Countdown bar shown while resting between sets.
 *
 * Renders nothing when idle, so callers can mount it unconditionally.
 */
export function RestTimerBar() {
  const colors = useColors();
  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const adjustRest = useTimer((state) => state.adjustRest);
  const stopRest = useTimer((state) => state.stopRest);
  const notificationsEnabled = useSettings((state) => state.restTimerNotifications);

  // Only tick while a timer is actually running.
  const now = useTicker(1000, restEndsAt !== null);
  const remaining = remainingRestSeconds(restEndsAt, now);

  /** Keeps the scheduled notification in step with the on-screen countdown. */
  const handleAdjust = (delta: number) => {
    adjustRest(delta);

    if (!notificationsEnabled) return;

    const next = useTimer.getState().restEndsAt;
    if (next === null) {
      void cancelRestNotification();
      return;
    }
    void scheduleRestNotification(Math.ceil((next - Date.now()) / 1000));
  };

  const handleStop = () => {
    stopRest();
    void cancelRestNotification();
  };

  if (remaining === null) return null;

  const progress = restTotalSeconds > 0 ? 1 - remaining / restTotalSeconds : 1;
  const finished = remaining === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceElevated }]}>
      <View
        style={[
          styles.progress,
          {
            backgroundColor: finished ? colors.success : colors.accent,
            width: `${Math.min(100, Math.max(0, progress * 100))}%`,
          },
        ]}
      />

      <View style={styles.content}>
        <Pressable
          onPress={() => handleAdjust(-15)}
          hitSlop={8}
          accessibilityLabel="Subtract 15 seconds"
          style={styles.adjust}
        >
          <Text variant="label" color="textSecondary">
            −15
          </Text>
        </Pressable>

        <View style={styles.readout}>
          <Ionicons
            name={finished ? 'checkmark-circle' : 'timer-outline'}
            size={16}
            color={finished ? colors.success : colors.text}
          />
          <Text variant="numeric">{finished ? 'Rest complete' : formatDuration(remaining)}</Text>
        </View>

        <Pressable
          onPress={() => handleAdjust(15)}
          hitSlop={8}
          accessibilityLabel="Add 15 seconds"
          style={styles.adjust}
        >
          <Text variant="label" color="textSecondary">
            +15
          </Text>
        </Pressable>

        <Pressable onPress={handleStop} hitSlop={8} accessibilityLabel="Skip rest">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  // Anchored left with an explicit width so the fill can animate as a
  // percentage; `right` is deliberately unset.
  progress: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    opacity: 0.22,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  readout: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  adjust: { paddingHorizontal: spacing.sm },
});
