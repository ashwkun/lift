import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, fontSize, spacing, useColors } from '@/theme';

/** The bar's own height, before the system navigation area is added to it. */
const TAB_BAR_CONTENT_HEIGHT = 58;

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

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
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size + 6} color={color} />
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
