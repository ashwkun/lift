import { Ionicons } from '@expo/vector-icons';
import { and, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { font, fontSize, spacing, useColors } from '@/theme';

/** The bar's own height, before the system navigation area is added to it. */
const TAB_BAR_CONTENT_HEIGHT = 58;

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
          borderTopWidth: StyleSheet.hairlineWidth,
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
         * No switch animation, deliberately.
         *
         * A `shift` transition is driven from JS, so it competes with the very
         * thing it was covering for: the incoming tab mounts and runs its
         * database query on the same thread that is trying to move the scene.
         * The animation drops frames, and a stuttering 160ms is read as lag
         * where an instant cut is read as speed.
         */
        animation: 'none',
        // Inactive tabs stop re-rendering while blurred. Without it, every tab's
        // live query re-runs on each other tab's writes.
        freezeOnBlur: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: fontSize.xl, ...font('bold') },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      {/*
        The one tab that changes when something is happening.

        `add-circle` says "start"; once a session is open the tab means "go
        back to it", so the glyph becomes `play-circle` — the same play/add
        pairing the Workout screen's own button uses, so the two agree.

        The tint is the louder half. While a session runs the icon holds
        `accent` even when the tab is blurred, so from History or Profile the
        middle of the bar is lit while the other four sit at `textTertiary`.
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name={sessionOpen ? 'play-circle' : 'add-circle'}
              size={size + 6}
              color={sessionOpen ? colors.accent : color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Exercises',
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
