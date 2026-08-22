import { formatDuration } from '@lift/shared';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Button, Chip, PressableScale, Text, useSheetLayout } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { useTicker } from '@/hooks/use-ticker';
import { useSettings } from '@/store/settings';
import { readRest, useTimer } from '@/store/timer';
import {
  fontSize,
  HIT_SLOP,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  useColors,
} from '@/theme';

import {
  ADJUST_SECONDS,
  describeRest,
  spokenDuration,
  useRestControls,
  useRestProgress,
} from './rest-controls';

/*
 * The ring, in viewBox units rather than points.
 *
 * The SVG is laid out at `width="100%"` inside a square box, so every number
 * below is a proportion of whatever width the sheet ends up with: the ring and
 * its stroke scale together from a 320pt phone to a tablet without a second set
 * of measurements. A fixed pixel size would have to be either too small on the
 * large screens or wider than the small ones.
 */
const RING_VIEWBOX = 100;
const RING_STROKE = 7;
const RING_RADIUS = (RING_VIEWBOX - RING_STROKE) / 2;
const RING_CENTER = RING_VIEWBOX / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Past this the ring stops being a dial and starts being a hole in the sheet.
 * It only binds on tablets; every phone hits the row's width first.
 */
const RING_MAX_SIZE = 240;

/**
 * The `±` targets, deliberately larger than the 44 minimum.
 *
 * These are pressed with the phone held at arm's length, or on the floor, by
 * someone mid-set. The bar's controls are 44 because a docked row has no height
 * to spare; the sheet does.
 */
const ADJUST_SIZE = MIN_TOUCH_SIZE + spacing.md;

/** The same range the rest-duration editor allows, for the same reasons. */
const MIN_DRAFT_SECONDS = 5;
const MAX_DRAFT_SECONDS = 3600;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RestTimerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The resting exercise's configured rest: the chip, and the idle duration. */
  targetSeconds?: number | null;
  onEditRest?: () => void;
}

/**
 * The rest timer, expanded.
 *
 * The docked bar is what the countdown looks like while the user is logging the
 * next set: one row, four controls, gone the moment rest ends. This is what it
 * looks like when the timer itself is the thing being attended to: pausing,
 * changing how long rest should be, or starting one by hand between exercises.
 *
 * It reads the same clock and drives it through the same actions as the bar (see
 * `rest-controls`), so nothing here can disagree with the row underneath it.
 */
export function RestTimerSheet({
  visible,
  onClose,
  targetSeconds,
  onEditRest,
}: RestTimerSheetProps) {
  const colors = useColors();
  const sheetLayout = useSheetLayout();
  const controls = useRestControls();

  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const restKind = useTimer((state) => state.restKind);
  const restExerciseName = useTimer((state) => state.restExerciseName);

  const defaultRestSeconds = useSettings((state) => state.defaultRestSeconds);

  // Gated on `visible` as well as on the clock: a closed modal still renders its
  // children, and there is no reason for a sheet nobody can see to re-render
  // once a second behind the workout.
  const now = useTicker(1000, visible && restEndsAt !== null);
  const rest = readRest({ restEndsAt, restPausedSeconds, restTotalSeconds }, now);
  const frame = rest === null ? null : describeRest(rest, restKind, colors);

  /*
   * The duration offered when there is no rest to show.
   *
   * Re-seeded during render each time the sheet opens, against the values it was
   * last seeded from. The pattern `rest-duration-sheet` uses, and for the same
   * reason: an effect would land a commit later and show the previous number for
   * a frame. A rest that starts while the sheet is open takes over from the
   * draft on its own, because `rest` stops being null.
   */
  const offered = clampDraft(targetSeconds ?? defaultRestSeconds);
  const [draft, setDraft] = useState(offered);
  const [seed, setSeed] = useState({ visible, offered });

  if (seed.visible !== visible || seed.offered !== offered) {
    setSeed({ visible, offered });
    if (visible) setDraft(offered);
  }

  const remaining = useRestProgress({ idleValue: 1, enabled: visible });

  const ringProps = useAnimatedProps(() => ({
    // `strokeDasharray` is one circumference of dash followed by one of gap, so
    // the offset alone decides how much of the ring is drawn: none of it at a
    // full circumference, all of it at zero. Animating the offset keeps the
    // whole sweep on the UI thread: the alternative, re-rendering an arc path
    // from JS, is a new `d` string per frame on the thread this app can least
    // afford to load.
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - remaining.value),
  }));

  const idle = frame === null;
  /** No clock to act on: nothing started, or nothing left to cut short. */
  const leaveOnly = idle || frame.finished;

  // Quiet until it is running. A full accent ring on a timer that has not
  // started reads as a rest already under way, and the only thing this state
  // needs to say is "press Start".
  const tone = frame?.tone ?? colors.textSecondary;
  const readout = frame?.readout ?? formatDuration(draft);
  const readoutLabel = frame?.readoutLabel ?? `${spokenDuration(draft)} rest, not started`;
  const status = frame?.status ?? 'Rest timer';

  const adjust = (delta: number) => {
    if (idle) {
      haptics.selection();
      setDraft((current) => clampDraft(current + delta));
      return;
    }

    controls.adjust(delta);
  };

  const skip = () => {
    controls.stop();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        `accessible={false}` on both Pressables, deliberately.

        Pressable defaults to `accessible`, which collapses everything under it
        into one element. The backdrop would announce the whole sheet as a
        single button reading "Rest 1:30 minus 15 plus 15 Skip Pause", and none
        of the controls inside it could be reached. Tap-outside-to-dismiss has no
        screen reader equivalent here on purpose: the ghost button is one swipe
        away, and Android's back gesture already routes to `onRequestClose`.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }, sheetLayout.backdrop]}
        onPress={onClose}
      >
        {/* Swallows taps inside the card so they don't dismiss the sheet. */}
        <Pressable
          accessible={false}
          // Hides the workout behind the sheet from VoiceOver, so a swipe past
          // the last button lands on the heading again instead of wandering into
          // the set list underneath.
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              // Docked to the bottom edge, the buttons would otherwise sit under
              // the gesture pill. Centred, there is no pill to clear.
              paddingBottom: spacing.xl + sheetLayout.bottomInset,
            },
            sheetLayout.sheet,
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          {/* Decoration, not a control: this sheet is not draggable, and the
              grabber is here because a card against the bottom edge without one
              reads as stuck rather than dismissible. 36 × 4 is the size iOS
              draws its own.

              It goes when the card stops touching that edge. A grabber on a
              floating dialog is a handle for a drag that is not offered, in the
              middle of a window, pointing at nothing. The affordance it exists
              to supply is the one thing a centred dialog does not need. */}
          {!sheetLayout.sheet && (
            <View
              style={[styles.grabber, { backgroundColor: colors.borderStrong }]}
              pointerEvents="none"
            />
          )}

          <View style={styles.heading}>
            <View style={styles.status}>
              <Text variant="overline" style={{ color: tone }} numberOfLines={1}>
                {status}
              </Text>
              {restExerciseName ? (
                <Text variant="label" color="textTertiary" numberOfLines={1}>
                  {restExerciseName}
                </Text>
              ) : null}
            </View>

            {onEditRest !== undefined && targetSeconds != null && (
              <Chip
                label={formatDuration(targetSeconds)}
                icon="timer-outline"
                onPress={onEditRest}
                // A chip is 36 tall, and it is the only pressable thing in this
                // row: nothing for its slop to contest, and the ring's controls
                // are a full `spacing.lg` below.
                hitSlop={HIT_SLOP}
                accessibilityLabel={`Rest duration, ${spokenDuration(targetSeconds)}. Edit`}
              />
            )}
          </View>

          <View style={styles.ringRow}>
            <PressableScale
              onPress={() => adjust(-ADJUST_SECONDS)}
              accessibilityRole="button"
              accessibilityLabel={
                idle
                  ? `Subtract ${ADJUST_SECONDS} seconds from the rest duration`
                  : `Subtract ${ADJUST_SECONDS} seconds`
              }
              fill={colors.surfaceMuted}
              fillPressed={colors.surfacePressed}
              scaleTo={PRESS_SCALE_SMALL}
              style={[styles.adjust, { backgroundColor: colors.surfaceMuted }]}
            >
              <Text variant="label" color="textSecondary">
                −{ADJUST_SECONDS}s
              </Text>
            </PressableScale>

            <View style={styles.ring}>
              <Svg width="100%" height="100%" viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}>
                <Circle
                  cx={RING_CENTER}
                  cy={RING_CENTER}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={colors.surfaceMuted}
                  strokeWidth={RING_STROKE}
                />
                <AnimatedCircle
                  cx={RING_CENTER}
                  cy={RING_CENTER}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={tone}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  /*
                   * An SVG circle starts at three o'clock, and a countdown that
                   * begins anywhere but the top is a dial nobody can read at a
                   * glance. Stated in SVG's own transform syntax with the centre
                   * named explicitly: a `transform` in the React Native `style`
                   * of the `Svg` element looks equivalent and is not: the
                   * library lifts it out of the style and re-applies it in SVG
                   * space, where the default origin is the corner of the viewBox
                   * rather than the middle of the shape.
                   */
                  transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                  animatedProps={ringProps}
                />
              </Svg>

              <View style={styles.ringCenter} pointerEvents="none">
                {/* The second of the app's two deliberately large figures: the
                    same argument as the docked bar's readout, one step further
                    up because here the number is the entire content of the
                    surface rather than one item in a row. */}
                <Text
                  variant="numericLarge"
                  numberOfLines={1}
                  // The ring is sized from whatever width the row leaves, so on
                  // a narrow phone it lands near 150pt, and a 40px "+1:05"
                  // needs more than that. The figure gives way rather than the
                  // ring, which is the shape that carries the state.
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  accessibilityLabel={readoutLabel}
                  style={[styles.readout, { color: tone }]}
                >
                  {readout}
                </Text>
              </View>
            </View>

            <PressableScale
              onPress={() => adjust(ADJUST_SECONDS)}
              accessibilityRole="button"
              accessibilityLabel={
                idle
                  ? `Add ${ADJUST_SECONDS} seconds to the rest duration`
                  : `Add ${ADJUST_SECONDS} seconds`
              }
              fill={colors.surfaceMuted}
              fillPressed={colors.surfacePressed}
              scaleTo={PRESS_SCALE_SMALL}
              style={[styles.adjust, { backgroundColor: colors.surfaceMuted }]}
            >
              <Text variant="label" color="textSecondary">
                +{ADJUST_SECONDS}s
              </Text>
            </PressableScale>
          </View>

          {/*
            Two buttons, in the same two places whatever the timer is doing. The
            pair changes what it says: Close/Start before a rest, Skip/Pause
            during one, Close/Done after the bell, but a control that appears
            and disappears under a thumb is the mis-tap this whole rebuild was
            about.

            There is nothing left to skip once the bell has rung, so the ghost
            stops offering it and goes back to being a way out that leaves the
            finished timer where it is. Two buttons that both mean "dismiss"
            would be one of them lying about doing something else.
          */}
          <View style={styles.actions}>
            <Button
              title={leaveOnly ? 'Close' : 'Skip'}
              variant="ghost"
              accessibilityLabel={leaveOnly ? 'Close the rest timer' : 'Skip rest'}
              onPress={leaveOnly ? onClose : skip}
              style={styles.action}
            />

            {idle ? (
              <Button
                title="Start"
                accessibilityLabel={`Start a ${spokenDuration(draft)} rest`}
                onPress={() => controls.start(draft)}
                style={styles.action}
              />
            ) : frame.finished ? (
              <Button
                title="Done"
                accessibilityLabel="Dismiss the finished rest timer"
                onPress={skip}
                style={styles.action}
              />
            ) : (
              <Button
                title={frame.paused ? 'Resume' : 'Pause'}
                accessibilityLabel={frame.paused ? 'Resume rest' : 'Pause rest'}
                onPress={controls.togglePause}
                style={styles.action}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function clampDraft(seconds: number): number {
  return Math.min(MAX_DRAFT_SECONDS, Math.max(MIN_DRAFT_SECONDS, Math.round(seconds)));
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  grabber: {
    width: 36,
    height: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  status: { flex: 1, gap: 2 },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  /**
   * `flex: 1` with a square aspect, so the ring takes whatever the two controls
   * leave and its height follows. The one measurement the sheet does not have
   * to state, and therefore the one that cannot be wrong on a screen size nobody
   * tested.
   */
  ring: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: RING_MAX_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inset from the ring's own bounds, because that is the box the readout is
  // shrunk to fit: at full width the figure would be sized to touch the stroke
  // on both sides, which is the one place a countdown must not land.
  ringCenter: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: { fontSize: fontSize.display, letterSpacing: -0.6 },
  adjust: {
    width: ADJUST_SIZE,
    height: ADJUST_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
