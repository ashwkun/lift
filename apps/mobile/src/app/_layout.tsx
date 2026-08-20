import { useFonts } from 'expo-font';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../../drizzle/migrations';

import { Button, DialogHost, headerOptions, Text } from '@/components/ui';
import { db } from '@/db/client';
import { seedExerciseLibrary } from '@/db/seed';
import { writeBackupFile } from '@/features/backup';
import { useSyncTriggers } from '@/features/sync/use-sync-triggers';
import { RestCues } from '@/features/workouts/rest-cues';
import { WorkoutNotice } from '@/features/workouts/workout-notice';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { loadPersistedRest } from '@/store/timer-persistence';
import { AppThemeProvider, spacing, useColors, useTheme } from '@/theme';

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
          {/*
            Outside `Bootstrap`, not inside `AppNavigator`, and not keyed on
            `attempt`. `StartupError` is rendered *instead of* the navigator and
            still raises dialogs — its export button reports where the file went
            — so a host mounted under the navigator would not exist on the one
            screen with no other way to say anything. Sitting here it also
            survives the remount a retry performs, which is what stops a dialog
            raised by the failing attempt from being torn down mid-read.
          */}
          <DialogHost />
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
 * first frame is already the bundled face instead of flashing a system one
 * and reflowing.
 */
function Bootstrap({ onRetry }: { onRetry: () => void }) {
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);
  const hydrate = useSettings((state) => state.hydrate);
  const hydrated = useSettings((state) => state.hydrated);

  // The keys here are the names `fontFamily` in the tokens refers to: expo-font
  // registers each face under the key it is given, on both platforms, so these
  // two lists have to agree and nothing else in the app names a font. Four
  // upright cuts, which is every weight the theme asks for — see `fontFamily`
  // for which role gets which, and why no italic is loaded.
  //
  // Required relatively rather than through the `@/assets` alias, matching the
  // app's other bundled assets (`notifications/sounds.ts`): the alias is
  // configured for module imports, and an asset `require` is not worth finding
  // out about at runtime.
  const [fontsLoaded, fontError] = useFonts({
    'LiftSans-Regular': require('../../assets/fonts/LiftSans-Regular.ttf'),
    'LiftSans-Medium': require('../../assets/fonts/LiftSans-Medium.ttf'),
    'LiftSans-Bold': require('../../assets/fonts/LiftSans-Bold.ttf'),
    'LiftSans-Extrabold': require('../../assets/fonts/LiftSans-Extrabold.ttf'),
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

  // But it is worth *saying*, because the fallback is silent and total: one
  // unreadable face fails the whole `useFonts` call, every weight in the theme
  // resolves to the system font, and the app looks exactly like a build where
  // the type tokens were never applied. That is indistinguishable by eye from a
  // stale Metro cache, and the two have completely different fixes — so the one
  // the app actually knows about says so rather than leaving it to be guessed.
  useEffect(() => {
    if (__DEV__ && fontError) {
      console.warn(
        `[fonts] Falling back to the system face — the bundled family did not load. ${fontError.message}`,
      );
    }
  }, [fontError]);

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
          // The shared set, spread rather than restated. This stack and the tab
          // navigator each used to declare their own and drifted apart — see
          // `headerOptions` for what that cost and what it now fixes.
          ...headerOptions(colors),
          /*
           * The stack half of the same decision, and it can only live here: a
           * back button exists on pushed screens and nowhere else, so this is
           * not an option the tab navigator can take.
           *
           * `minimal` keeps the chevron and drops the word beside it. iOS
           * otherwise labels the control with the previous screen's title,
           * which on a stack whose titles are sentences — "Personal records",
           * "Set count per muscle" — puts a back button wider than the title it
           * sits next to, and pushes the title along to make room for itself.
           * `headerBackTitleVisible` is the older spelling of this and still
           * typechecks, but react-native-screens now drives the native
           * `UINavigationItemBackButtonDisplayMode` directly, so the newer name
           * is the one that maps onto what the platform actually does.
           */
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
          /**
           * The platform's own push, with no override.
           *
           * This used to carry a warning that any explicit animation hitched,
           * because these screens mount straight into a database query and the
           * two landed on top of each other. That was true, and it was never
           * about the animation: a native stack push runs on the OS side and
           * cannot be slowed down by JS. What hitched was the *incoming mount* —
           * the query resolving mid-push and re-rendering a screenful of charts.
           * `useDeferredFocusEffect` moves that work behind the transition, and
           * with it gone there is nothing left here to compensate for.
           *
           * It stays on the platform default anyway, on its own merits: iOS and
           * Android disagree about what a push looks like, users of each expect
           * their own, and the OS knows the current gesture-navigation setting
           * where a constant in this file would not.
           */

          /*
           * No `freezeOnBlur` here, unlike the tab navigator.
           *
           * It would be a real saving — a covered screen's live queries re-run
           * on every write the user cannot see — but the stack is the one place
           * a blurred screen gets *looked at* before it is focused again: an
           * iOS back-swipe reveals the screen underneath progressively, under
           * the user's thumb, for as long as the gesture lasts. Unfreezing is
           * driven from the transition, so what is revealed at the start of that
           * drag is a subtree React has not resumed yet.
           *
           * That is the same class of artefact this pass exists to remove, and
           * trading it for query traffic the tab bar's own `freezeOnBlur`
           * already covers most of is not a trade worth making.
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
        void showAlert('Sharing unavailable', `File written to:\n${file.uri}`);
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Lift backup',
      });
    } catch (exportError) {
      void showAlert('Export failed', (exportError as Error).message);
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
