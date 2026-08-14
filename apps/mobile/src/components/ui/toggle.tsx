import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { elevation, radius, useTheme } from '@/theme';

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 31;
const THUMB_SIZE = 25;
const THUMB_INSET = 2;
/**
 * How far the thumb slides.
 *
 * The border counts twice over: React Native sizes borders inside `width`, so
 * the usable track is narrower than `TRACK_WIDTH` by a hairline at each end.
 * Leaving it out lands the thumb a fraction past the padding on the "on" side —
 * not enough to see, enough to make the two ends visibly uneven.
 */
const BORDER_WIDTH = StyleSheet.hairlineWidth;
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - (THUMB_INSET + BORDER_WIDTH) * 2;

const DURATION_MS = 180;

export interface ToggleProps extends Omit<PressableProps, 'style' | 'children' | 'onPress'> {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * On/off switch.
 *
 * Replaces React Native's `Switch`, which is not one control but two: iOS
 * renders `UISwitch` and Android renders a Material 3 switch with a different
 * size, a different thumb, and its own icon inside the thumb. Only the track
 * colour is themeable on both, so the accent was the *one* part of the control
 * that matched the app and everything around it did not. This is drawn from
 * plain views, so it is identical on both platforms and reads from the palette
 * like every other control.
 *
 * The thumb runs on the native driver (transform only); the track colour cannot
 * — `backgroundColor` interpolation has no native equivalent — so the two are
 * separate drivers started together rather than one shared value forced onto
 * the JS thread.
 */
export function Toggle({ value, onValueChange, disabled = false, style, ...rest }: ToggleProps) {
  const { colors, isDark } = useTheme();

  // `useState` with a lazy initialiser rather than `useRef`: the React Compiler
  // rejects reading `.current` during render, and these are read in the JSX
  // below. Same one-per-mount lifetime, no setter ever called.
  const [slide] = useState(() => new Animated.Value(value ? 1 : 0));
  const [tint] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    const toValue = value ? 1 : 0;
    const easing = Easing.out(Easing.cubic);

    const animation = Animated.parallel([
      Animated.timing(slide, { toValue, duration: DURATION_MS, easing, useNativeDriver: true }),
      Animated.timing(tint, { toValue, duration: DURATION_MS, easing, useNativeDriver: false }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [value, slide, tint]);

  const trackColor = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surfaceMuted, colors.accent],
  });

  // The off track is a dark fill on a dark card, so it needs an outline to be
  // findable at all; the on track is bright enough that a border would only
  // muddy its edge, hence the fade to its own colour.
  const borderColor = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.borderStrong, colors.accent],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[disabled && styles.disabled, style]}
      {...rest}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor, borderColor }]}>
        <Animated.View
          style={[
            styles.thumb,
            elevation(2, isDark),
            {
              transform: [
                { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) },
              ],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: BORDER_WIDTH,
    padding: THUMB_INSET,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.pill,
    // White in both themes, like the physical switch it is imitating: the thumb
    // is the part that has to stay findable against a lime track *and* against
    // a dark one, and only white does both.
    backgroundColor: '#FFFFFF',
  },
  disabled: { opacity: 0.4 },
});
