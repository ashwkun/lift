/**
 * The two motion primitives the rest of the UI is built from.
 *
 * `PressableScale` is what a tap feels like; `Reveal` is what arriving content
 * looks like. Both run entirely on the UI thread, which is the whole point —
 * this app's screens are usually busy resolving a SQLite aggregate at exactly
 * the moment they are being touched or transitioned into, and any feedback
 * driven from JS would queue behind that work and arrive late. Late feedback is
 * worse than none: it reads as the app having missed the tap.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeInDown,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  canHover,
  duration,
  easing,
  PRESS_SCALE,
  spring,
  STAGGER_MAX_MS,
  STAGGER_STEP_MS,
  timing,
} from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ---------------------------------------------------------------------------
// PressableScale
// ---------------------------------------------------------------------------

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /**
   * Plain styles only — no `({ pressed }) => …` function.
   *
   * That is the point of this component rather than an oversight. The function
   * form is React Native asking JS for a new stylesheet on press-in and again
   * on press-out, which means two re-renders of the pressed subtree per tap. On
   * a set row inside a list of set rows that is a measurable hitch on the exact
   * gesture the app exists to serve. Everything that used to be expressed as a
   * pressed style is a prop here instead, and it animates on the UI thread.
   */
  style?: StyleProp<ViewStyle>;
  /** Resting fill. Only needed alongside `fillPressed`. */
  fill?: string;
  /** Fill at full press, crossfaded from `fill`. */
  fillPressed?: string;
  /**
   * Resting outline, for a control whose border has to travel with its fill.
   *
   * Only for shapes that keep their border the same colour as what it encloses —
   * the chip, whose outline is its own fill so that a rounded 1pt stroke has no
   * seam to show (see `stroke` in the tokens). Leaving it out while the fill
   * crossfades would leave a ring of the resting colour around a pressed centre,
   * which is the exact artefact the chip's border rule exists to prevent.
   */
  border?: string;
  /** Outline at full press, crossfaded from `border`. */
  borderPressed?: string;
  /**
   * Fill while a cursor is over the control. Requires `fill`.
   *
   * The desktop half of `fillPressed`, and it exists because a pointer needs an
   * answer that a finger does not. A finger arrives already touching, so
   * press-in *is* the first contact and the pressed fill is the whole response.
   * A cursor hovers first, and a row that does not acknowledge it reads as
   * decoration rather than as something you can click — the single most common
   * way a phone layout feels wrong in a browser.
   *
   * Ignored where the pointer cannot hover, so a touchscreen never lights a
   * state it has no way to leave. See `canHover`.
   *
   * Applied on the frame the cursor arrives rather than faded in — see the note
   * on `hovered` in the implementation for why this one channel is React state
   * while the other four are worklets.
   */
  hoverFill?: string;
  /** Scale at full press. Pass `1` for full-bleed rows — see `PRESS_SCALE`. */
  scaleTo?: number;
  /**
   * Opacity at full press. For controls with no fill of their own to darken —
   * a bare glyph, an outlined button on the canvas — where a colour step has
   * nothing to step from.
   */
  dimTo?: number;
}

/**
 * A `Pressable` that responds to the touch itself rather than only to what the
 * touch does.
 *
 * The four channels — scale, fill, outline, opacity — are all driven off one
 * shared value, so a control can combine them without four animations racing.
 * Press-in is a timing because the response has to be immediate and linear to
 * the gesture; press-out is a spring because release is the half that gets to
 * feel physical. Both are short: see `duration.instant`.
 */
export function PressableScale({
  style,
  fill,
  fillPressed,
  border,
  borderPressed,
  hoverFill,
  scaleTo = PRESS_SCALE,
  dimTo = 1,
  disabled,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  ...rest
}: PressableScaleProps) {
  const press = useSharedValue(0);

  /*
   * Hover is React state where press is a shared value, and the asymmetry is
   * the point rather than an inconsistency.
   *
   * Press is on the UI thread because it has to be: it fires under a finger, on
   * a set row inside a list of set rows, at the exact moment the screen is
   * usually resolving a SQLite aggregate — the whole reason this component
   * exists (see the note at the top of the file). Hover fires twice per pointer
   * pass, on a desktop, from a mouse. Two renders of one pressable is not a
   * budget worth a second worklet.
   *
   * It is also the only formulation the React Compiler accepts. A second shared
   * value feeding `interpolateColor` makes its immutability analysis reclassify
   * *both* shared values as frozen, and `react-hooks/immutability` then rejects
   * every `.value` write in the component — including the two press writes that
   * predate any of this. Reading a shared value into arithmetic is fine; routing
   * one into a colour interpolation is not.
   *
   * What this costs is the crossfade on the hover itself: the resting fill
   * changes in one frame instead of over 140ms. The press crossfade is
   * unaffected and now simply starts from whichever fill is currently resting,
   * so hovering and then clicking travels hover → pressed exactly as intended.
   */
  const [hovered, setHovered] = useState(false);

  // Which of the four channels are live is decided here, once, from props that
  // do not change under a finger — and a channel that is off is left out of the
  // animated style entirely rather than returned at its resting value.
  //
  // That is not an optimisation, it is correctness. The animated style is
  // applied *after* `style`, so a `transform: [{ scale: 1 }]` returned by an
  // unscaled pressable would silently overwrite a transform the caller set, and
  // an `opacity: 1` would overwrite the 0.4 that renders a disabled button as
  // disabled. Emitting only what is actually being driven leaves everything
  // else to the stylesheet, where it belongs.
  //
  // The key set still has to hold steady for the life of an animation —
  // swapping it mid-flight is what leaves a Reanimated style stuck on its last
  // value — and it does: a theme change re-runs this with new colours, not new
  // keys, and `disabled` flipping mid-press cancels the gesture anyway.
  const scaled = scaleTo !== 1;
  const dimmed = dimTo !== 1;
  const tinted = fill !== undefined && fillPressed !== undefined;
  const outlined = border !== undefined && borderPressed !== undefined;
  // Both halves have to be present, and the device has to have a cursor. A
  // `hoverFill` with no `fill` has nothing to replace, and on a touchscreen the
  // state could be entered and never left.
  const hovers = canHover && tinted && hoverFill !== undefined;

  /*
   * Which fill the press crossfade starts from.
   *
   * This is the whole of the hover channel: the endpoint moves, and the
   * existing single-shared-value interpolation carries it. The worklet is
   * therefore byte-identical in shape to what it was before hover existed,
   * which is what keeps the phone path — where `hovers` is always false and
   * `resting` is always `fill` — exactly as it was.
   */
  const resting = hovers && hovered ? hoverFill : fill;

  const animatedStyle = useAnimatedStyle(() => {
    const progress = press.value;

    return {
      ...(scaled ? { transform: [{ scale: 1 - (1 - scaleTo) * progress }] } : null),
      ...(dimmed ? { opacity: 1 - (1 - dimTo) * progress } : null),
      ...(tinted && resting !== undefined
        ? { backgroundColor: interpolateColor(progress, [0, 1], [resting, fillPressed]) }
        : null),
      ...(outlined
        ? { borderColor: interpolateColor(progress, [0, 1], [border, borderPressed]) }
        : null),
    };
  });

  return (
    <AnimatedPressable
      disabled={disabled}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        press.value = withTiming(1, timing.press);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        press.value = withSpring(0, spring.release);
        onPressOut?.(event);
      }}
      /*
       * Gated on `hovers` so a pressable with no hover fill never re-renders
       * for a cursor passing over it. The caller's own handlers are forwarded
       * either way — that is their business, not this component's.
       */
      onHoverIn={(event) => {
        if (hovers) setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        if (hovers) setHovered(false);
        onHoverOut?.(event);
      }}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/**
 * How far revealed content travels.
 *
 * Deliberately tiny. Reanimated's own `FadeInDown` starts 25pt below, which on
 * a stat band or a chart is enough to read as the element sliding into place —
 * a second, competing transition on top of the one the navigator just ran.
 * 10pt is under the threshold where the eye tracks the movement, so what
 * registers is that the content *settled* rather than that it moved.
 */
const RISE = 10;

export interface RevealProps {
  children: ReactNode;
  /**
   * Position within a group that appears together. Adds a capped stagger so a
   * section reads as one thing arriving in order rather than four unrelated
   * things arriving at once. Omit it for a single block.
   */
  index?: number;
  /** Extra delay in ms, added on top of any stagger. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fades and lifts its children in on mount.
 *
 * This is the other half of `useDeferredFocusEffect`. Holding a screen's
 * queries until the transition finishes means the numbers land a beat after the
 * screen does, and without this that beat is a pop: a blank masthead one frame,
 * a 40pt figure the next. Wrapping the block that depends on the query turns
 * the same delay into the content resolving, which is a thing interfaces are
 * allowed to do.
 *
 * Mount is the trigger, so put it around the subtree that is conditional on the
 * data — a `Reveal` that mounts with the screen and never unmounts animates
 * once, on arrival, and stays still through every later update.
 */
export function Reveal({ children, index = 0, delay = 0, style }: RevealProps) {
  const stagger = Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS);

  return (
    <Animated.View
      style={style}
      entering={FadeInDown.duration(duration.base)
        .easing(easing.out)
        .delay(stagger + delay)
        .withInitialValues({ transform: [{ translateY: RISE }] })
        .reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}
