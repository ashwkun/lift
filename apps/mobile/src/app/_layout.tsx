import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../../drizzle/migrations';

import { Text } from '@/components/ui';
import { db } from '@/db/client';
import { seedExerciseLibrary } from '@/db/seed';
import { useSettings } from '@/store/settings';
import { AppThemeProvider, spacing, useColors, useTheme } from '@/theme';

// Held until migrations, seeding and settings hydration all finish, so the
// first frame the user sees is real content rather than an empty shell.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <Bootstrap />
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Runs the startup sequence in order: schema migrations, then the exercise
 * library seed (which needs the tables), then preferences.
 */
function Bootstrap() {
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);
  const hydrate = useSettings((state) => state.hydrate);
  const hydrated = useSettings((state) => state.hydrated);

  const [seedError, setSeedError] = useState<Error | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!migrated) return;

    let cancelled = false;

    void (async () => {
      try {
        await seedExerciseLibrary();
        await hydrate();
        if (!cancelled) setSeeded(true);
      } catch (error) {
        if (!cancelled) setSeedError(error as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [migrated, hydrate]);

  const ready = migrated && seeded && hydrated;
  const error = migrationError ?? seedError;

  useEffect(() => {
    if (ready || error) void SplashScreen.hideAsync();
  }, [ready, error]);

  if (error) return <StartupError error={error} />;
  if (!ready) return <StartupSpinner />;

  return <AppNavigator />;
}

function AppNavigator() {
  const { isDark } = useTheme();
  const colors = useColors();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

function StartupSpinner() {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function StartupError({ error }: { error: Error }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text variant="subheading" align="center">
        Couldn&apos;t start IronLog
      </Text>
      <Text variant="body" color="textSecondary" align="center" style={styles.errorDetail}>
        {error.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  errorDetail: { maxWidth: 320 },
});
