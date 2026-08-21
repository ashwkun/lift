import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type PanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { controlHeight, radius, spacing, stroke, timing, useColors } from '@/theme';
import { haptics } from '@/features/feedback/haptics';

import { Button } from './button';
import { useSheetLayout } from './sheet-layout';
import { Text } from './text';

export interface ReorderItem {
  id: string;
  label: string;
  /** Second line: set count, target, whatever names the row without the drag. */
  detail?: string;
}

export interface ReorderSheetProps {
  visible: boolean;
  /** Heads the sheet: "Reorder exercises". */
  title: string;
  /** In their current order. */
  items: ReorderItem[];
  onClose: () => void;
  /** Called once, on Done, with the ids in the order they were left in. */
  onCommit: (orderedIds: string[]) => void;
}

/** One row, and the pitch the drag maths counts in. */
const ROW_HEIGHT = controlHeight.lg;
const ROW_GAP = spacing.xs;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;

/** How much of the screen the list may take before it scrolls. */
const MAX_LIST_FRACTION = 0.55;

/** Lift on the row under the finger. Small — it is a card, not a balloon. */
const DRAG_SCALE = 1.03;

/**
 * Drag-to-reorder, on a surface built for it.
 *
 * The lists this reorders — exercises in a session, exercises in a routine —
 * are not draggable where they live. Each entry there is a block a few hundred
 * points tall containing text fields and swipe-to-delete rows: a vertical pan
 * on one of those has to be told apart from a scroll, from a swipe, and from a
 * caret drag inside a weight field, and the block being moved is usually taller
 * than the screen it is being moved across. Reordering by dragging *names*
 * instead makes every row the same known height, leaves nothing else on the
 * surface competing for the gesture, and shows the whole list at once — which
 * is the thing you actually need to see to know where a block should go.
 *
 * The order is applied on Done rather than per drop. A drag is a rehearsal
 * until then: reordering a live session rewrites rows that a running query is
 * reading, and doing that on every crossing while a finger is still down means
 * the list can renumber under the drag.
 */
export function ReorderSheet({ visible, title, items, onClose, onCommit }: ReorderSheetProps) {
  const colors = useColors();
  const sheetLayout = useSheetLayout();
  const { height } = useWindowDimensions();

  const [order, setOrder] = useState<ReorderItem[]>(items);

  // Re-seeded whenever the sheet opens, or the list behind it changes while it
  // is closed. Adjusted during render against what it was last seeded from, the
  // same shape `PromptModal` and the rest timer bar use — an effect would paint
  // the previous session's exercises for a frame first.
  const [seed, setSeed] = useState({ visible, items });

  if (seed.visible !== visible || seed.items !== items) {
    setSeed({ visible, items });
    if (visible) setOrder(items);
  }

  // -1 when nothing is being dragged. Both are read on the UI thread by every
  // row's style, so they are shared values rather than state — a 60fps drag
  // cannot be a React render per frame while a live query is also running.
  const activeIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  /*
   * Whether a finger is currently on a handle, in JS rather than on the UI
   * thread, because the only thing that reads it is a `ScrollView` prop.
   *
   * The handle sits inside a scrollable and a vertical pan is precisely what a
   * scrollable is for, so the two compete for the drag. RNGH's own answer to
   * that is `blocksExternalGesture(ref)`, which cannot be used here: it wants
   * the ref read while the gesture is built, the gestures are built during
   * render, and the React Compiler — on for this app — refuses a ref read
   * during render. Turning the scroll off for the length of the drag settles
   * the same argument with a prop.
   */
  const [dragging, setDragging] = useState(false);

  const count = order.length;

  const move = (from: number, to: number) => {
    if (from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      return next;
    });
  };

  /*
   * Built here rather than inside the row, because the two shared values are
   * written here.
   *
   * A row that received them as props and assigned to `.value` is a component
   * mutating its own props as far as the React Compiler is concerned, and this
   * app compiles with it on (`experiments.reactCompiler` in `app.json`) — so
   * that is a lint error, and the rule is right about the general case even
   * though a shared value is mutable by design. Rows still *read* both, which
   * is what `useAnimatedStyle` needs and what the rule permits.
   */
  const dragGesture = (index: number) =>
    Gesture.Pan()
      .onStart(() => {
        activeIndex.value = index;
        dragY.value = 0;
        runOnJS(setDragging)(true);
        runOnJS(haptics.selection)();
      })
      .onUpdate((event) => {
        dragY.value = event.translationY;
      })
      .onEnd(() => {
        const to = landing(index, dragY.value, count);
        if (to !== index) runOnJS(move)(index, to);
      })
      // Runs after `onEnd`, and also on the paths that have no `onEnd` at all —
      // a call arriving, the sheet being dismissed mid-drag. Clearing here
      // rather than there means a cancelled gesture puts the row back instead
      // of committing wherever the finger happened to be. Not animated back to
      // zero: on a real drop the row is about to re-render at its new index,
      // and easing the old offset out would show it sliding from a position it
      // has already left.
      .onFinalize(() => {
        activeIndex.value = -1;
        dragY.value = 0;
        runOnJS(setDragging)(false);
      });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        A second root view, inside the modal, and the drag does not work without
        it.

        `GestureHandlerRootView` is not a context provider with a native view
        attached — on Android it *is* the native view, and it installs the touch
        recogniser that feeds every handler beneath it. A React Native `Modal`
        mounts its children into a separate native window, so the app's root view
        in `app/_layout.tsx` is nowhere above this content in the native tree and
        never sees the touches.

        Nothing says so at runtime. `GestureDetector` checks for the root view
        through React context, and React context passes through a `Modal` quite
        happily, so the check is satisfied while the thing it is checking for is
        absent: no warning, no error, and a pan that silently never activates.
        That is what this looked like in Expo Go.

        Every other gesture in the app — the swipe-to-delete on a set row — sits
        in the ordinary tree under the root view, which is why this is the first
        place it has come up.
      */}
      <GestureHandlerRootView style={styles.flex}>
        {/* `accessible={false}` on the backdrop for the reason every sheet in
            this app carries it: Pressable defaults to accessible and would
            collapse the whole list into one element announcing every exercise
            name in a row. */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }, sheetLayout.backdrop]}
          onPress={onClose}
        >
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              paddingBottom: spacing.lg + sheetLayout.bottomInset,
            },
            sheetLayout.sheet,
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text variant="overline" color="textTertiary" accessibilityRole="header">
            {title}
          </Text>

          {/* The list scrolls past its cap, and the drag deliberately does not
              auto-scroll with it: a finger that reaches the edge stops there.
              Ten exercises is a long session and fits without scrolling on any
              phone this runs on, so the case is rare — and the accessibility
              actions below move a row any distance regardless. */}
          <ScrollView
            scrollEnabled={!dragging}
            style={{ maxHeight: height * MAX_LIST_FRACTION }}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {order.map((item, index) => (
              <Row
                key={item.id}
                item={item}
                index={index}
                count={count}
                activeIndex={activeIndex}
                dragY={dragY}
                gesture={dragGesture(index)}
                onMove={move}
              />
            ))}
          </ScrollView>

            <View style={styles.actions}>
              <Button title="Cancel" variant="ghost" onPress={onClose} style={styles.action} />
              <Button
                title="Done"
                onPress={() => onCommit(order.map((item) => item.id))}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

interface RowProps {
  item: ReorderItem;
  index: number;
  count: number;
  /** Read-only here. Only `ReorderSheet` writes them — see `dragGesture`. */
  activeIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  gesture: PanGesture;
  onMove: (from: number, to: number) => void;
}

function Row({ item, index, count, activeIndex, dragY, gesture, onMove }: RowProps) {
  const colors = useColors();

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;

    // Nothing moving: every row sits where its index says.
    if (active === -1) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0 };

    // The dragged row follows the finger exactly, and rides above the rest.
    if (active === index) {
      return {
        transform: [{ translateY: dragY.value }, { scale: DRAG_SCALE }],
        zIndex: 1,
      };
    }

    // Everything else steps aside by exactly one row, or does not. There is no
    // partial displacement on purpose: a row that slides continuously with the
    // finger says "somewhere around here", and the only question this list
    // answers is which side of a neighbour the block ends up on.
    const to = landing(active, dragY.value, count);
    const shift =
      active < index && index <= to
        ? -ROW_PITCH
        : to <= index && index < active
          ? ROW_PITCH
          : 0;

    return {
      transform: [{ translateY: withTiming(shift, timing.state) }, { scale: 1 }],
      zIndex: 0,
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <View
        style={[
          styles.row,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        ]}
        // One element per row for the screen reader, carrying both lines and the
        // two actions below — the label alone is what a swipe lands on, and the
        // drag it describes is not something a screen reader can perform.
        accessible
        accessibilityLabel={
          `${index + 1} of ${count}. ${item.label}${item.detail ? `. ${item.detail}` : ''}`
        }
        accessibilityActions={ACTIONS}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'moveUp' && index > 0) onMove(index, index - 1);
          if (event.nativeEvent.actionName === 'moveDown' && index < count - 1) {
            onMove(index, index + 1);
          }
        }}
      >
        <View style={styles.rowText}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {item.label}
          </Text>
          {item.detail ? (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              {item.detail}
            </Text>
          ) : null}
        </View>

        {/* The gesture hangs off the handle rather than the whole row, so the
            list underneath can still be scrolled by dragging anywhere else. */}
        <GestureDetector gesture={gesture}>
          <View style={styles.handle}>
            <Ionicons name="reorder-three" size={22} color={colors.textTertiary} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

/**
 * Which index a drag of `offset` from `from` would land on.
 *
 * Rounding rather than flooring: a row is taken to have crossed its neighbour
 * once it has travelled *half* a row past it, which is where the neighbour
 * visibly steps aside. Shared by the dragged row and by every row deciding
 * whether to move out of its way, so the two can never disagree about what is
 * happening.
 */
function landing(from: number, offset: number, count: number): number {
  'worklet';
  const target = from + Math.round(offset / ROW_PITCH);
  return Math.min(count - 1, Math.max(0, target));
}

const ACTIONS = [
  { name: 'moveUp', label: 'Move up' },
  { name: 'moveDown', label: 'Move down' },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  list: { gap: ROW_GAP, paddingVertical: spacing.xs },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  rowText: { flex: 1 },
  // The handle is the target, so it is a full-height column rather than a glyph
  // with slop — slop on a row this dense would reach into its neighbours.
  handle: {
    width: controlHeight.md,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
