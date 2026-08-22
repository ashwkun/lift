import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { radius, spacing, stroke, timing, useColors } from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

/** How far a segment's label fades while it is held. */
const SEGMENT_PRESSED_OPACITY = 0.55;

/** Inset between the track's edge and the thumb, on all four sides. */
const TRACK_PADDING = 3;
/** Matches the `gap` in `styles.track`, which the thumb has to account for. */
const SEGMENT_GAP = 2;

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `sm` is for a control nested inside a card, next to a heading. */
  size?: 'sm' | 'md';
  /** Announced before the selected segment, e.g. "Time range". */
  label?: string;
  style?: ViewStyle;
}

/**
 * A row of mutually exclusive options in a single track.
 *
 * Used where the choice reshapes the view rather than filtering it: the chart's
 * metric and time range. `FilterSelect` is the counterpart for dimensions with
 * many values: this one shows every option at once, so it stops being usable
 * past four or five.
 *
 * The selection is a single thumb that slides, not a fill that jumps from one
 * segment to the next. That is the difference between the control reading as
 * one object being moved and as two independent segments changing colour at the
 * same time, and it matters more here than almost anywhere else in the app:
 * every segmented control in this app is attached to a chart, so the thumb's
 * travel is the only thing that connects the tap to the redraw that follows it.
 *
 * The thumb is positioned from a measured track width rather than from flex,
 * because a `left` that flex has not resolved yet cannot be animated. Until the
 * first layout lands the width is 0 and the thumb is simply not drawn: one
 * frame, and one where the labels are already in place.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  style,
}: SegmentedControlProps<T>) {
  const colors = useColors();
  const height = size === 'sm' ? 30 : 36;

  const [trackWidth, setTrackWidth] = useState(0);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  // What one segment occupies, gaps included: the track's inner width less the
  // gaps between segments, divided evenly, and then the gap added back for
  // every step the thumb travels.
  const inner = Math.max(0, trackWidth - TRACK_PADDING * 2);
  const segmentWidth =
    options.length > 0 ? (inner - SEGMENT_GAP * (options.length - 1)) / options.length : 0;

  // Driven from a shared value updated in an effect rather than by calling
  // `withTiming` inside the animated style. Both work, and this one states the
  // one rule the control actually has: the very first placement is a *position*
  // and every one after it is a *move*. Snapping on the first measured layout is
  // what stops a control whose selection is not the first option from sliding
  // its thumb in from the left every time the screen mounts.
  const offset = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (segmentWidth <= 0) return;

    const target = selectedIndex * (segmentWidth + SEGMENT_GAP);

    if (placed.current) {
      offset.value = withTiming(target, timing.travel);
    } else {
      offset.value = target;
      placed.current = true;
    }
  }, [selectedIndex, segmentWidth, offset]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[
        styles.track,
        { backgroundColor: colors.surfaceMuted, padding: TRACK_PADDING },
        style,
      ]}
    >
      {segmentWidth > 0 && (
        <Animated.View
          // Decoration, and decoration that used to be a property of the
          // selected segment: the tab still announces `selected`, so a reader
          // that stopped on the thumb as well would be reporting the selection
          // twice, once as an unnamed element.
          aria-hidden
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              height,
              width: segmentWidth,
              top: TRACK_PADDING,
              left: TRACK_PADDING,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
            thumbStyle,
          ]}
        />
      )}

      {options.map((option) => {
        const selected = option.value === value;

        return (
          <PressableScale
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label ? `${label}: ${option.label}` : option.label}
            onPress={() => onChange(option.value)}
            // The segment has no fill of its own to darken. The thumb owns the
            // only surface in this control, and it must not scale, because a
            // shrinking segment under a stationary thumb would look like the
            // two had come apart. Fading the label is what is left, and it is
            // enough: it is the only thing in the segment.
            scaleTo={1}
            dimTo={SEGMENT_PRESSED_OPACITY}
            style={[styles.segment, { height }]}
          >
            {/* Only the label changes colour per segment now: the surface
                underneath it belongs to the thumb. The colour still steps
                rather than crossfading, which is right: it has to be legible
                the instant the thumb starts moving, not once it arrives. */}
            <Text
              variant="label"
              numberOfLines={1}
              style={{ color: selected ? colors.text : colors.textSecondary }}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    gap: SEGMENT_GAP,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  thumb: {
    position: 'absolute',
    borderRadius: radius.sm + 1,
    borderWidth: stroke.outline,
  },
});
