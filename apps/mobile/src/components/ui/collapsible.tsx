/**
 * A section that can be folded away, for dashboards read above a list.
 *
 * History is the case this exists for. Its analytics are four blocks tall, and
 * every one of them sits between the user and the thing the screen is named
 * after. Folded, the same four blocks are four lines of type, and the first
 * workout is on the first screen.
 *
 * Collapsed is the default here, which is the opposite of the usual accordion.
 * An accordion normally hides secondary detail behind a primary view; these are
 * a dashboard sitting on top of a list, so the question is not "is this worth
 * hiding" but "did you come here to read it". Most visits to History are
 * looking for a session. The visit that wants the body map is one tap away and
 * knows it wants it.
 *
 * ## What it does not animate
 *
 * The height. Measuring a body map and a year of squares to interpolate a
 * container around them is a layout pass per frame for a transition nobody
 * asked to watch, and on the mid-range Android this app targets that reads as
 * the fold *sticking*. The chevron turns, the content fades in where it lands,
 * and the state change is legible from both. `timing.state` for the turn, which
 * is the token for a control flipping state and carries `ReduceMotion.System`
 * with it.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from './motion';
import { Text } from './text';
import { duration, easing, MIN_TOUCH_SIZE, radius, spacing, timing, useColors } from '../../theme';

export interface CollapsibleSectionProps {
  title: string;
  /**
   * A line of type on the right of the header, read while folded.
   *
   * The point of the whole component: a section worth collapsing usually has
   * one number in it that answers the question most of the time. "8 muscles"
   * on a folded body map means the fold costs nothing on the visits that only
   * wanted the count.
   *
   * Drawn while folded and dropped once open, since the block itself then says
   * the same thing at length.
   */
  summary?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  summary,
  defaultExpanded = false,
  children,
}: CollapsibleSectionProps) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const turn = useSharedValue(defaultExpanded ? 1 : 0);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 90}deg` }],
  }));

  const toggle = () => {
    turn.value = withTiming(expanded ? 0 : 1, timing.state);
    setExpanded((open) => !open);
  };

  return (
    <View>
      <PressableScale
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={summary && !expanded ? `${title}, ${summary}` : title}
        accessibilityState={{ expanded }}
        // No fill and no scale. This is a heading that happens to be tappable,
        // not a control sitting on the canvas, and a heading that shrinks under
        // the thumb reads as the section itself moving.
        scaleTo={1}
        style={styles.header}
      >
        {/* Pointing right when folded and down when open, which is the one
            rotation that means the same thing in both directions of travel. */}
        <Animated.View style={chevron}>
          <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
        </Animated.View>

        <Text variant="overline" color="textSecondary" style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        {/* Folded only. The summary is a stand-in for the block, so once the
            block is on screen it is a heading restating the thing underneath
            it: `ChartReadout` already opens with the same count in a fuller
            sentence. */}
        {summary && !expanded ? (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </PressableScale>

      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(duration.fast)
            .easing(easing.out)
            .reduceMotion(ReduceMotion.System)}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // The row is the target, and it is the full width of the section: a
    // chevron and a word of type come to about 90pt, and a heading you have to
    // hit precisely is worse than no fold at all.
    minHeight: MIN_TOUCH_SIZE,
    borderRadius: radius.sm,
  },
  // Takes the slack so the summary sits hard right rather than trailing the
  // title, which is what keeps a column of these aligned with each other.
  title: { flex: 1 },
});
