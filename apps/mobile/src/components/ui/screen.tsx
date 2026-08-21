import { useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { contentWidth, stroke, timing, useColors, useLayout, type ContentWidth } from '@/theme';

/**
 * How far the content has to travel before the header is given its edge.
 *
 * Not zero. A list resting at the top still reports fractional offsets — a
 * rubber-band settle on iOS, a stray pixel from a keyboard inset — and a line
 * that flickers on at 0.4pt of travel reads as a rendering fault rather than as
 * a boundary. Two points is under the threshold where anyone would call the
 * page scrolled, and above the noise.
 */
const EDGE_OFFSET = 2;

/**
 * The scroll-edge wiring: what to spread onto the list, and what to hand to the
 * `Screen` so it can draw the line.
 *
 * Two halves because the two ends of it live in different places — the scroll
 * view is somewhere inside the screen's tree and the line is at the top of it —
 * and passing them explicitly is what keeps a screen's scroll connected to its
 * *own* header edge. Context cannot do this job: the hook has to be called in
 * the component that renders `<Screen>`, which is above the provider a `Screen`
 * could offer, so it would read straight past it.
 */
export interface ScrollEdge {
  /** Spread onto the one scroll view, list or section list the screen scrolls. */
  list: {
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    scrollEventThrottle: number;
  };
  /** Pass to `Screen` as `scrolled`. 0 at rest, 1 once the page has moved. */
  progress: SharedValue<number>;
}

/**
 * Gives a screen's header an edge once its content passes underneath.
 *
 * ```tsx
 * const scrollEdge = useScrollEdge();
 * <Screen scrolled={scrollEdge.progress}>
 *   <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
 * ```
 *
 * A plain JS handler rather than a Reanimated worklet, and the trade is worth
 * stating. A worklet would keep the whole thing off the JS thread, but it also
 * requires every list in the app to become an `Animated.ScrollView` — including
 * two FlashLists, where that is a wrapper this app would then own. What this
 * costs instead is one comparison per scroll frame and a shared-value write on
 * the two frames per gesture where the answer changes. There is no `setState`
 * anywhere in it, so scrolling still re-renders nothing.
 */
export function useScrollEdge(): ScrollEdge {
  const progress = useSharedValue(0);

  // The last value *asked for*, held here rather than read back off the shared
  // value: mid-fade that holds an interpolated number, so comparing against it
  // would restart the timing on every frame of the 140ms it takes to appear.
  const target = useRef(0);

  return {
    list: {
      onScroll: (event) => {
        const next = event.nativeEvent.contentOffset.y > EDGE_OFFSET ? 1 : 0;
        if (target.current === next) return;

        target.current = next;
        progress.value = withTiming(next, timing.state);
      },
      scrollEventThrottle: 16,
    },
    progress,
  };
}

export interface ScreenProps {
  children: ReactNode;
  /**
   * Which edges get safe-area padding. Screens inside the tab navigator should
   * usually omit 'bottom' — the tab bar already covers that inset, and padding
   * it twice leaves a visible gap.
   */
  edges?: ('top' | 'bottom')[];
  /**
   * From `useScrollEdge`. Given one, the screen draws a hairline under the
   * header that fades in once the page is scrolled. Screens with nothing to
   * scroll leave it out and get no line, which is the honest state — there is
   * no content passing under the header to separate from it.
   */
  scrolled?: SharedValue<number>;
  style?: ViewStyle;
  /** Use the raised surface colour, e.g. for modals presented over a screen. */
  elevated?: boolean;
  /**
   * How wide this screen's content may draw once there is more room than a
   * phone has. Ignored below `breakpoint.medium`, where the window is the cap.
   *
   * `column` — the default — is right for anything that is a list or a detail
   * view. Choose `form` for a screen that is a single task, and `board` for one
   * that is several things at once. `full` opts out entirely and is for screens
   * that manage their own width; it is not a way to avoid deciding.
   *
   * See `contentWidth` for what each is worth and why.
   */
  width?: ContentWidth;
}

export function Screen({
  children,
  edges = [],
  scrolled,
  style,
  elevated = false,
  width = 'column',
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isWide } = useLayout();

  /*
   * The cap, applied to a wrapper that is always rendered.
   *
   * Always, even on a phone where it does nothing, because the alternative —
   * wrapping only when wide — swaps the children between two different parents
   * as the window crosses 840. React sees a different element type at that
   * position and unmounts the whole subtree: scroll position lost, every piece
   * of local state reset, every `Reveal` replayed. On a phone that never
   * happens; on the web it happens while someone is dragging a window edge,
   * which is exactly when it looks broken.
   *
   * A `flex: 1` view with no other styles is layout-transparent, so the phone
   * case is unaffected.
   */
  const cap = isWide && width !== 'full' ? contentWidth[width] : undefined;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: elevated ? colors.surface : colors.background },
        edges.includes('top') && { paddingTop: insets.top },
        edges.includes('bottom') && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {/*
        The header's bottom edge, drawn by the screen.

        It belongs to the header and cannot be drawn there: a native-stack
        header is a platform view react-native-screens owns, and it takes a
        background colour and a title style but not a border. What it does offer
        is `headerShadowVisible`, which is a *shadow* — invisible against the
        AMOLED canvas in dark mode, and on Android an elevation that is always
        on rather than one that answers the scroll.

        So the line is the first row of the content instead, flush under the
        header, where it reads as that header's edge. It is always rendered and
        only its opacity moves, so nothing below it shifts by a pixel when the
        page starts scrolling.
      */}
      {/*
        The edge stays outside the column, spanning the full pane.

        It is the header's bottom border, and the header is drawn by the native
        stack across the whole width of the content area — so a line inset to
        720pt would stop short of the header it belongs to and read as a rule
        drawn around the content instead.
      */}
      {scrolled && <ScrollEdgeLine progress={scrolled} />}
      <View style={[styles.column, cap !== undefined && { maxWidth: cap }]}>{children}</View>
    </View>
  );
}

function ScrollEdgeLine({ progress }: { progress: SharedValue<number> }) {
  const colors = useColors();
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.edge, { backgroundColor: colors.border }, style]}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // `width: '100%'` alongside `alignSelf` because a centred child sizes to its
  // content rather than to its parent — without it the column collapses to the
  // width of its widest row and the cap never applies.
  column: { flex: 1, width: '100%', alignSelf: 'center' },
  // One physical pixel: a straight line on the pixel grid, which is exactly the
  // case `stroke.rule` exists for. See the tokens.
  edge: { height: stroke.rule, zIndex: 1 },
});
