import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../../drizzle/migrations';

import { Button, Text } from '@/components/ui';
import { db } from '@/db/client';
import { seedExerciseLibrary } from '@/db/seed';
import { writeBackupFile } from '@/features/backup';
import { useSyncTriggers } from '@/features/sync/use-sync-triggers';
import { RestCues } from '@/features/workouts/rest-cues';
import { WorkoutNotice } from '@/features/workouts/workout-notice';
import { useSettings } from '@/store/settings';
import { loadPersistedRest } from '@/store/timer-persistence';
import { AppThemeProvider, font, spacing, useColors, useTheme } from '@/theme';

// Held until migrations, seeding, settings hydration and the stored rest period
// all finish, so the first frame the user sees is real content rather than an
// empty shell.
void SplashScreen.preventAutoHideAsync();

/**
 * Gives every route pushed from outside the app — a rest notification tap, a
 * `lift://` link into `/workout/active` — a real back stack. Without an anchor
 * the deep-linked screen is the only entry on the stack, so its back button is
 * missing and the user is stranded on a detail screen with no way into the app.
 */
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  // Remounting `Bootstrap` is what makes retry work: `useMigrations` runs its
  // effect once with an empty dependency list, so nothing short of a fresh
  // mount will re-attempt a failed migration.
  const [attempt, setAttempt] = useState(0);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <Bootstrap key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Runs the startup sequence in order: schema migrations, then the exercise
 * library seed (which needs the tables), then preferences and the rest period
 * left behind by the last process.
 *
 * Fonts load alongside all of that rather than after it — they're bundled
 * assets, not a network fetch, and gating the splash on them too means the
 * first frame is already Inter instead of flashing Roboto and reflowing.
 */
function Bootstrap({ onRetry }: { onRetry: () => void }) {
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);
  const hydrate = useSettings((state) => state.hydrate);
  const hydrated = useSettings((state) => state.hydrated);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [seedError, setSeedError] = useState<Error | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!migrated) return;

    let cancelled = false;

    void (async () => {
      try {
        await seedExerciseLibrary();
        await hydrate();
        // Rehydrating the rest period behind the splash is what keeps the bar
        // in the first painted frame instead of dropping in ~90pt later. It
        // never throws, so it needs no handling of its own here.
        await loadPersistedRest();
        if (!cancelled) setSeeded(true);
      } catch (error) {
        if (!cancelled) setSeedError(error as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [migrated, hydrate]);

  // A missing font is not worth blocking launch over — React Native falls back
  // to the system face, so `fontError` counts as "done loading", not as a
  // startup failure the way a failed migration does.
  const ready = migrated && seeded && hydrated && (fontsLoaded || Boolean(fontError));
  const error = migrationError ?? seedError;

  useEffect(() => {
    if (ready || error) void SplashScreen.hideAsync();
  }, [ready, error]);

  if (error) return <StartupError error={error} onRetry={onRetry} />;
  if (!ready) return <StartupSpinner />;

  return <AppNavigator />;
}

function AppNavigator() {
  const { isDark } = useTheme();
  const colors = useColors();

  // Syncs on launch and whenever the app returns to the foreground.
  useSyncTriggers();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Rest keeps running while the user browses exercises or history, so the
          bell is owned here rather than by the workout screen. Renders nothing. */}
      <RestCues />
      {/* Same reasoning: the workout notification has to outlive the workout
          screen, so it is driven from the root. Renders nothing. */}
      <WorkoutNotice />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: font('semibold'),
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          /**
           * The platform's own push, with no override.
           *
           * A forced `slide_from_right` at a hand-picked duration has to move
           * the whole incoming screen, and these screens mount straight into a
           * database query — the transition and the query land on top of each
           * other and the slide visibly hitches. The native default is shorter,
           * and the OS is better placed than a constant here to decide what a
           * push looks like.
           */
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

/**
 * The last screen before a dead app, so it has to offer more than the message.
 *
 * Retry remounts `Bootstrap` and re-runs the whole sequence — worth a tap,
 * because a locked database or a busy file system recovers on its own. Export
 * is the escape hatch that matters: the training log only exists on this phone,
 * and a failed migration is exactly when someone reaches for a reinstall.
 *
 * Export runs inline rather than pushing `/export`. When this renders there is
 * no navigator mounted — `Bootstrap` returned this instead of the `Stack` — so
 * a route push here would go nowhere. Writing the file needs reads only, which
 * a database that opened can still serve even when migrating it failed.
 */
function StartupError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const colors = useColors();
  const [exporting, setExporting] = useState(false);

  const exportBackup = async () => {
    setExporting(true);
    try {
      const file = await writeBackupFile();

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', `File written to:\n${file.uri}`);
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Lift backup',
      });
    } catch (exportError) {
      Alert.alert('Export failed', (exportError as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text variant="subheading" align="center">
        Couldn&apos;t start Lift
      </Text>
      <Text variant="body" color="textSecondary" align="center" style={styles.errorDetail}>
        {error.message}
      </Text>
      <Text variant="caption" color="textTertiary" align="center" style={styles.errorDetail}>
        Your workouts are still on this device. Export a copy before reinstalling.
      </Text>
      <View style={styles.errorActions}>
        <Button title="Try again" onPress={onRetry} disabled={exporting} fullWidth />
        <Button
          title="Export a backup"
          variant="secondary"
          icon="download-outline"
          loading={exporting}
          disabled={exporting}
          onPress={() => void exportBackup()}
          fullWidth
        />
      </View>
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
  errorActions: {
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
