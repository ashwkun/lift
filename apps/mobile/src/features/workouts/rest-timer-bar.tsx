import { Ionicons } from '@expo/vector-icons';
import { formatDuration } from '@lift/shared';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing as ReanimatedEasing,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { cancelRestNotification, scheduleRestNotification } from '@/features/notifications/rest';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import {
  OVERTIME_LIMIT_SECONDS,
  readRest,
  useTimer,
  type RestKind,
  type RestSnapshot,
} from '@/store/timer';
import { fontSize, radius, spacing, stroke, useColors, type Palette } from '@/theme';

/** Below this the readout turns amber — the "get back under the bar" window. */
const WARNING_SECONDS = 10;

/**
 * The open/close of the bar's own height.
 *
 * Reanimated rather than the `Animated` this file already uses for the fill:
 * a height is a layout prop, so RN's driver would have to run it on the JS
 * thread — the one busy with a controlled text input every time the user types
 * a weight while resting. `ReduceMotion.System` then honours the OS setting
 * without a re-render to observe it.
 */
const COLLAPSE = {
  duration: 180,
  easing: ReanimatedEasing.out(ReanimatedEasing.quad),
  reduceMotion: ReduceMotion.System,
};

/*
 * Touch targets for the control row, tiled rather than uniform.
 *
 * The five controls sit `spacing.sm` apart and each used to declare a bare
 * `hitSlop={8}`, so both sides of every gap claimed all of it. React Native
 * hit-tests siblings in reverse order, which means the later one silently wins
 * a contested point: a tap at the right edge of Pause landed on −15 and took
 * time off the rest instead of holding it. Half a gap each is the most either
 * side can take without the other reaching the same point.
 *
 * Vertically the controls are 34 tall and reach 46. Four up tiles the header's
 * `gap: spacing.xs` without reaching the chip that sits above it; eight down
 * stays inside the container's own `paddingBottom`.
 */
const CONTROL_SLOP_V = { top: 4, bottom: 8 };
const PAUSE_SLOP = { ...CONTROL_SLOP_V, left: 8, right: 4 };
const MINUS_SLOP = { ...CONTROL_SLOP_V, left: 4, right: 8 };
const PLUS_SLOP = { ...CONTROL_SLOP_V, left: 8, right: 4 };
const CLOSE_SLOP = { ...CONTROL_SLOP_V, left: 4, right: 8 };

/*
 * The chip's row holds nothing else pressable, so its slop only has to make up
 * height: `minHeight: 32` on the chip plus eight up and four down is exactly
 * 44. Four at the bottom rather than eight because below it is the controls
 * row, where Pause's own top slop is already waiting.
 */
const CHIP_SLOP = { top: 8, bottom: 4, left: 8, right: 8 };

export interface RestTimerBarProps {
  /**
   * The rest this exercise is configured for. Shown as a chip that opens the
   * duration editor; omitting it (or `onEditRest`) hides the chip.
   */
  targetSeconds?: number | null;
  onEditRest?: () => void;
}

/**
 * The countdown between sets.
 *
 * Occupies no height when idle, so callers can mount it unconditionally — but
 * it gets there by animating its own height closed rather than unmounting.
 * Ninety points of layout that appears and vanishes under a thumb already
 * travelling towards the next checkbox is how a mis-tap completes the wrong
 * set. Permanently reserving the space would cost more than it saves, so the
 * bar keeps drawing its final state while it slides shut.
 *
 * The progress fill is a single native-driven animation whose duration is the
 * time actually left, not a value nudged once a second from JS. That matters
 * twice over: the sweep is smooth instead of stepping, and it costs nothing on
 * the JS thread — which is busy with a controlled text input every time the
 * user types a weight while resting.
 */
export function RestTimerBar({ targetSeconds, onEditRest }: RestTimerBarProps) {
  const colors = useColors();

  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const restExerciseName = useTimer((state) => state.restExerciseName);
  const restKind = useTimer((state) => state.restKind);
  const adjustRest = useTimer((state) => state.adjustRest);
  const pauseRest = useTimer((state) => state.pauseRest);
  const resumeRest = useTimer((state) => state.resumeRest);
  const stopRest = useTimer((state) => state.stopRest);

  const notificationsEnabled = useSettings((state) => state.restTimerNotifications);

  // Only tick while the clock is actually moving. A paused timer shows a frozen
  // number, and an idle one is collapsed to nothing.
  const now = useTicker(1000, restEndsAt !== null);
  const rest = readRest({ restEndsAt, restPausedSeconds, restTotalSeconds }, now);

  const [trackWidth, setTrackWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // Lazy initialiser rather than a ref: the value is read during render to
  // build the interpolation, which is exactly what a ref is not for.
  const [fill] = useState(() => new Animated.Value(0));

  const height = useSharedValue(0);

  const visible = rest !== null;

  /*
   * A native animation is driven by the UI thread, which stops while the app is
   * backgrounded — it resumes from where it froze rather than from where the
   * wall clock has since moved to. Re-running the animation on every return to
   * the foreground snaps the fill back onto the real deadline.
   */
  const [resyncToken, setResyncToken] = useState(0);

  useEffect(() => {
    /*
     * Rest that has been over for minutes is no longer information, so it stops
     * occupying the screen past the overtime limit. Checked here rather than
     * from the once-a-second ticker: the only ways to bank three minutes of
     * overtime are to leave the app or to leave this screen, and a store write
     * fired out of a render that a clock drives is a re-render loop waiting to
     * be written.
     */
    const dropExpired = () => {
      const state = useTimer.getState();
      const snapshot = readRest(state, Date.now());

      if (snapshot !== null && snapshot.overtime >= OVERTIME_LIMIT_SECONDS) state.stopRest();
    };

    dropExpired();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      dropExpired();
      setResyncToken((token) => token + 1);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    fill.stopAnimation();

    const totalMs = Math.max(1, restTotalSeconds) * 1000;

    if (restPausedSeconds !== null) {
      fill.setValue(clamp01(1 - (restPausedSeconds * 1000) / totalMs));
      return;
    }

    // Left where it stopped rather than reset: the bar is still on screen for
    // the length of the collapse, and draining the fill under it would be a
    // second animation nobody asked for. Every new period sets the value below.
    if (restEndsAt === null) return;

    const remainingMs = restEndsAt - Date.now();

    if (remainingMs <= 0) {
      fill.setValue(1);
      return;
    }

    fill.setValue(clamp01(1 - remainingMs / totalMs));

    const animation = Animated.timing(fill, {
      toValue: 1,
      duration: remainingMs,
      // Linear because the bar is a clock face: any easing would make it lie
      // about how much time is left.
      easing: Easing.linear,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [fill, restEndsAt, restPausedSeconds, restTotalSeconds, resyncToken]);

  useEffect(() => {
    // Nothing measured yet means nothing has ever been shown, and the bar is
    // already closed — animating to a height it has not been told is a jump.
    if (contentHeight === 0) return;

    // `spacing.sm` is the gap to the content below, folded into the animated
    // height so it closes with the bar instead of surviving it as a stray gap.
    height.value = withTiming(visible ? contentHeight + spacing.sm : 0, COLLAPSE);
  }, [contentHeight, height, visible]);

  const wrapperStyle = useAnimatedStyle(() => ({ height: height.value }));

  /** Keeps the scheduled notification in step with whatever the clock now says. */
  const syncNotification = useCallback(() => {
    const { restEndsAt: next, restExerciseName: name } = useTimer.getState();

    if (!notificationsEnabled || next === null) {
      void cancelRestNotification();
      return;
    }

    const seconds = Math.ceil((next - Date.now()) / 1000);
    if (seconds <= 0) {
      void cancelRestNotification();
      return;
    }

    void scheduleRestNotification(seconds, name ?? undefined);
  }, [notificationsEnabled]);

  const handleAdjust = useCallback(
    (delta: number) => {
      // `selection`, not `countdownTick`: the tick belongs to the clock running
      // out, and it means nothing if four buttons say the same thing.
      haptics.selection();
      adjustRest(delta);
      syncNotification();
    },
    [adjustRest, syncNotification],
  );

  const handleTogglePause = useCallback(() => {
    haptics.selection();
    if (useTimer.getState().restPausedSeconds !== null) resumeRest();
    else pauseRest();
    syncNotification();
  }, [pauseRest, resumeRest, syncNotification]);

  const handleStop = useCallback(() => {
    // Skipping a rest that is still running is finishing it early, so it earns
    // the cue the clock would have given at zero. Dismissing a bar whose bell
    // has already rung does not ring it a second time.
    const snapshot = readRest(useTimer.getState(), Date.now());

    if (snapshot !== null && !snapshot.finished) haptics.restComplete();
    else haptics.selection();

    stopRest();
    void cancelRestNotification();
  }, [stopRest]);

  const frame = rest === null ? null : describeRest(rest, restKind, colors);
  const showChip = onEditRest !== undefined && targetSeconds != null;

  return (
    <Reanimated.View style={[styles.wrapper, wrapperStyle]} pointerEvents={visible ? 'auto' : 'none'}>
      {frame !== null && (
        <Reanimated.View
          /*
           * Out of flow, so it lays out at its natural height whatever the
           * wrapper is currently animating to and the wrapper clips the
           * difference. The exiting animation is here to keep the card on
           * screen while that collapse plays — without it React unmounts the
           * content on the frame the timer clears and the bar slides shut
           * empty; the fade is incidental.
           */
          style={[
            styles.container,
            { backgroundColor: colors.surfaceElevated, borderColor: frame.tone },
          ]}
          exiting={FadeOut.duration(COLLAPSE.duration).reduceMotion(ReduceMotion.System)}
          onLayout={(event) => {
            setTrackWidth(event.nativeEvent.layout.width);
            setContentHeight(event.nativeEvent.layout.height);
          }}
        >
          {trackWidth > 0 && (
            <Animated.View
              // Translated rather than scaled: `scaleX` grows from the centre, and
              // correcting that needs `transformOrigin`, which not every surface
              // this runs on honours. A full-width layer slid in from the left is
              // the same animation with none of that risk.
              style={[
                styles.progress,
                {
                  backgroundColor: frame.tone,
                  transform: [
                    {
                      translateX: fill.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-trackWidth, 0],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}

          <View style={styles.header}>
            <View style={styles.status}>
              <Ionicons name={frame.icon} size={13} color={frame.tone} />
              <Text variant="overline" style={{ color: frame.tone }} numberOfLines={1}>
                {frame.status}
              </Text>
              {restExerciseName ? (
                <Text variant="overline" color="textTertiary" numberOfLines={1} style={styles.flex}>
                  · {restExerciseName}
                </Text>
              ) : null}
            </View>

            {showChip && (
              <Pressable
                onPress={onEditRest}
                hitSlop={CHIP_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`Rest duration, ${formatDuration(targetSeconds)}. Edit`}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
                  },
                ]}
              >
                <Text variant="caption" color="textSecondary">
                  {formatDuration(targetSeconds)}
                </Text>
                <Ionicons name="chevron-down" size={11} color={colors.textTertiary} />
              </Pressable>
            )}
          </View>

          <View style={styles.controls}>
            <Pressable
              onPress={handleTogglePause}
              hitSlop={PAUSE_SLOP}
              disabled={frame.finished}
              accessibilityRole="button"
              accessibilityLabel={frame.paused ? 'Resume rest' : 'Pause rest'}
              style={({ pressed }) => [
                styles.control,
                {
                  backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
                  opacity: frame.finished ? 0.35 : 1,
                },
              ]}
            >
              <Ionicons name={frame.paused ? 'play' : 'pause'} size={16} color={colors.text} />
            </Pressable>

            <Pressable
              onPress={() => handleAdjust(-15)}
              hitSlop={MINUS_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Subtract 15 seconds"
              style={({ pressed }) => [
                styles.control,
                { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
              ]}
            >
              <Text variant="label" color="textSecondary">
                −15
              </Text>
            </Pressable>

            {/* `numericLarge` asks for tabular figures so the digits don't jitter
                as the seconds roll over — at this size a shifting colon is very
                hard to ignore, which makes this the screen where a family
                without them shows up worst. */}
            <Text
              variant="numericLarge"
              style={[styles.readout, { color: frame.tone }]}
              accessibilityLabel={frame.readoutLabel}
            >
              {frame.readout}
            </Text>

            <Pressable
              onPress={() => handleAdjust(15)}
              hitSlop={PLUS_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Add 15 seconds"
              style={({ pressed }) => [
                styles.control,
                { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
              ]}
            >
              <Text variant="label" color="textSecondary">
                +15
              </Text>
            </Pressable>

            <Pressable
              onPress={handleStop}
              hitSlop={CLOSE_SLOP}
              accessibilityRole="button"
              accessibilityLabel={frame.finished ? 'Dismiss rest timer' : 'Skip rest'}
              style={({ pressed }) => [
                styles.control,
                { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
              ]}
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        </Reanimated.View>
      )}
    </Reanimated.View>
  );
}

/** Everything the bar draws, resolved once from a single reading of the clock. */
interface RestFrame {
  tone: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  status: string;
  readout: string;
  readoutLabel: string;
  paused: boolean;
  finished: boolean;
}

function describeRest(rest: RestSnapshot, kind: RestKind | null, colors: Palette): RestFrame {
  const tone = rest.finished
    ? colors.success
    : rest.paused
      ? colors.textSecondary
      : rest.remaining <= WARNING_SECONDS
        ? colors.warning
        : colors.accent;

  // Rest after a warm-up is capped short on purpose, and forty-five seconds
  // where the user expects two minutes reads as a bug unless the bar says why.
  const status = rest.finished
    ? 'Rest complete'
    : rest.paused
      ? 'Paused'
      : kind === 'warmup'
        ? 'Warm-up rest'
        : 'Rest';

  const readout = rest.finished
    ? rest.overtime > 0
      ? `+${formatDuration(rest.overtime)}`
      : '0:00'
    : formatDuration(rest.remaining);

  /*
   * Spelled out for the screen reader, which reads "1:30" as "one thirty".
   * Deliberately a label and not a live region: live regions are Android-only,
   * and pointing one at a number that changes every second turns the screen
   * reader into a metronome. `RestCues` announces the two moments that matter.
   */
  const readoutLabel = rest.finished
    ? rest.overtime > 0
      ? `Rest complete, ${spokenDuration(rest.overtime)} over`
      : 'Rest complete'
    : `${status}, ${spokenDuration(rest.remaining)} left`;

  return {
    tone,
    icon: rest.finished ? 'checkmark-circle' : rest.paused ? 'pause' : 'timer-outline',
    status,
    readout,
    readoutLabel,
    paused: rest.paused,
    finished: rest.finished,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Words rather than a clock face, for the one reader that has to say it aloud. */
function spokenDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];

  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (remainder > 0 || minutes === 0) {
    parts.push(`${remainder} second${remainder === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

const styles = StyleSheet.create({
  /** Owns the height the bar occupies, and clips the card while it changes. */
  wrapper: {
    overflow: 'hidden',
    marginHorizontal: spacing.lg,
  },
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  /**
   * A full-width layer behind the content, slid in from the left by the
   * animation. `opacity` keeps it a tint rather than a block — the readout sits
   * on top of it and has to stay legible from either side of the boundary.
   */
  progress: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0.18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  flex: { flex: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    // Real height, because slop alone cannot reach 44 here: there are only 8
    // points above the chip and 4 below it before the controls row. Around an
    // 11px caption the old `paddingVertical: 3` measured 21pt.
    minHeight: 32,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  control: {
    minWidth: 44,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  /**
   * One of the two figures in the app that stays big, and it asks explicitly
   * rather than inheriting it.
   *
   * `numericLarge` came down to 20px when the stat surfaces stopped announcing
   * themselves, and this is not a stat — it is a countdown read from wherever
   * the phone was put down between sets, which is usually the floor. The
   * argument that quietened the dashboards does not reach it: nobody glances at
   * a volume total mid-set with 40 seconds left. The other exception is the
   * plate calculator, for the same reason and with the same explicitness.
   */
  readout: { flex: 1, textAlign: 'center', fontSize: fontSize.xxxl, letterSpacing: -0.6 },
});
