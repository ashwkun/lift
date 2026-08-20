import { Ionicons } from '@expo/vector-icons';
import { and, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { ColorValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headerOptions } from '@/components/ui';
import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { font, fontSize, spacing, spring, stroke, timing, useColors } from '@/theme';

/** The bar's own height, before the system navigation area is added to it. */
const TAB_BAR_CONTENT_HEIGHT = 58;

/** How far a tab icon overshoots before settling when its tab is selected. */
const ICON_POP_SCALE = 1.14;

/**
 * The icon in a tab bar button, with a pop when its tab becomes the current one.
 *
 * The bar is the one piece of chrome on every screen, and switching tabs is the
 * most frequent navigation in the app, so it is the place where a missing
 * response is felt most often. The tint change alone is a state readout; the
 * pop is the part that answers the finger.
 *
 * It fires on becoming focused and never on mount. A bar whose icon jumps the
 * first time it is drawn is announcing the app's own startup, which is not an
 * event the user did anything to cause — and on a cold launch it lands in the
 * same few frames as the first screen's first paint, which is the last moment
 * to be spending on decoration.
 */
function TabIcon({
  name,
  size,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size: number;
  color: ColorValue;
  focused: boolean;
}) {
  const scale = useSharedValue(1);
  const wasFocused = useRef(focused);

  useEffect(() => {
    // Only the falling edge of "not focused" → "focused". Blurring is silent:
    // the tab being left is not the one the user is looking at.
    if (focused && !wasFocused.current) {
      scale.value = withSequence(
        withTiming(ICON_POP_SCALE, timing.press),
        withSpring(1, spring.bounce),
      );
    }
    wasFocused.current = focused;
  }, [focused, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  /**
   * Does a session exist — nothing else about it.
   *
   * A workout is app-global but its only affordance used to live on one tab out
   * of five, so anyone who tapped History mid-session had to remember which tab
   * resumes. The bar is the one piece of chrome present on all five, so it is
   * where that fact belongs.
   *
   * One column, one row, and no join: this query sits above every tab, so it
   * pays on every screen in the app. Drizzle's live query re-runs only when the
   * table it selects from changes (`expo-sqlite/query.js` filters the change
   * listener by table name), and `workouts` is written on start, finish and
   * discard — not on the set writes that fire every keystroke. Selecting the
   * sets, or the exercises, would put the whole logging screen's write traffic
   * through a re-render of the tab bar.
   *
   * `useRows` is not needed here: the unloaded frame reads as "no session",
   * which is the bar's own resting state, so the worst it can do is light one
   * frame late. Nothing here claims an absence the way an empty state would.
   */
  const { data: openSessions = [] } = useLiveQuery(
    db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .limit(1),
  );

  const sessionOpen = openSessions.length > 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        /**
         * The bar sits on the canvas colour, not `surface`. On AMOLED that keeps
         * the bottom of the screen genuinely unlit and stops a faintly lighter
         * strip from floating under every screen.
         *
         * Height and bottom padding both include `insets.bottom`. React
         * Navigation normally works that inset in for you, but only while it
         * owns the height — giving `tabBarStyle` a fixed `height` overrides that
         * calculation entirely, and on Android's edge-to-edge default the bar
         * then renders underneath the gesture pill or the 3-button bar.
         */
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: stroke.rule,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingTop: spacing.xs,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
          ...font('medium'),
        },
        tabBarItemStyle: { paddingVertical: spacing.xs / 2 },
        /**
         * A 150ms crossfade, replacing the hard cut that used to be here.
         *
         * The cut was put in on the belief that a tab transition is driven from
         * JS and therefore competes with the incoming tab's database query.
         * Half of that is wrong: React Navigation animates the scene with
         * `Animated.timing` under `useNativeDriver`, so the fade itself runs on
         * the UI thread and cannot be stalled by anything JS is doing. The
         * query was real, and it is now held behind the transition by
         * `useDeferredFocusEffect`.
         *
         * What the cut actually bought was a *shorter* glitch, not the absence
         * of one: an instant jump to a tab that has not painted yet, then its
         * content popping in a few frames later. A crossfade covers exactly
         * that gap — there is no moving edge for the eye to track, so a scene
         * that is still resolving underneath simply arrives during the fade.
         *
         * `fade` rather than `shift` for the same reason. A slide would give a
         * directional cue the three fixed tabs could genuinely use, but it also
         * puts a hard edge on screen travelling 50pt, and an unpainted screen
         * behind a hard edge is visible in a way one behind a fade is not.
         */
        animation: 'fade',
        // Inactive tabs stop re-rendering while blurred. Without it, every tab's
        // live query re-runs on each other tab's writes.
        freezeOnBlur: true,
        // The same set the root stack spreads. This navigator titled its own
        // screens at 20/bold against the stack's 17/semibold, so pushing from
        // Home visibly shrank the title — `headerOptions` is where that lives
        // now, and neither navigator gets to disagree with it.
        ...headerOptions(colors),
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="home" size={size} color={color} focused={focused} />
          ),
        }}
      />
      {/*
        The middle tab, and the one that changes when something is happening.

        Three tabs rather than four is what puts it in the middle — under the
        thumb, at the widest target the bar has — and starting a workout is the
        thing this app is opened to do. Everything that was competing for that
        position was a place to *read* about training rather than to do it.

        `add-circle` says "start"; once a session is open the tab means "go
        back to it", so the glyph becomes `play-circle` — the same play/add
        pairing the Workout screen's own button uses, so the two agree.

        The tint is the louder half. While a session runs the icon holds
        `accent` even when the tab is blurred, so from Home or Profile the
        middle of the bar is lit while the other two sit at `textTertiary`.
        The label deliberately stays on the inactive tint: lighting both would
        make the tab look selected, which would be a lie about where you are.

        What this is not: a static state, changed at most a few times per
        session. No elapsed clock lives here. A counter in the tab bar would
        re-render the bar every second on top of whichever screen the user is
        actually working on — the mistake `ElapsedStat` on the active screen is
        written to avoid.
      */}
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          // Only overridden while live: otherwise the tab announces its label,
          // which is already right.
          tabBarAccessibilityLabel: sessionOpen ? 'Workout, session in progress' : undefined,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name={sessionOpen ? 'play-circle' : 'add-circle'}
              size={size + 6}
              color={sessionOpen ? colors.accent : color}
              focused={focused}
            />
          ),
        }}
      />
      {/*
        No History or Exercises tab. Three is the whole bar.

        Both were places to look something up rather than to do something, and a
        permanent tab is the most expensive piece of chrome the app has to give:
        every one of them narrows the middle target that starts a workout. The
        library is a reference book, opened to check one lift, and the place
        people actually reach for an exercise is the picker inside a session.
        History is read after training, not during — and Home already carries
        the last few sessions, which is the part of it anyone checks daily.

        Both now hang off Profile, which is what that tab is for: everything
        about training that isn't training. Neither lost a feature in the move,
        only a permanent seat.
      */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="person" size={size} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
