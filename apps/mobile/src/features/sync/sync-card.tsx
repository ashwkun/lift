import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Card, IconButton, Text } from '@/components/ui';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSync, type SyncStatus } from '@/store/sync';
import { radius, spacing, useColors } from '@/theme';

import { authClient, useSession } from './auth-client';
import { resetSyncState, retryRejected, RETIRED_LIMIT } from './engine';

/**
 * Account and sync status.
 *
 * Signed out is a completely valid state — the app is local-first, and this is
 * framed as an optional backup rather than a wall in front of the product.
 */
export function SyncCard() {
  const colors = useColors();
  const { data: session, isPending } = useSession();

  const {
    status,
    lastSyncedAt,
    lastError,
    pending,
    rejected,
    rejectionReason,
    sync,
    refreshPending,
    markSignedOut,
  } = useSync();

  // Read on every focus, not once at mount. The profile tab stays mounted
  // after its first visit, and the only other writer of these counts is a
  // finished sync run — so a card that read them once went on saying "All
  // changes synced" over a session logged two taps away.
  useDeferredFocusEffect(
    useCallback(() => {
      void refreshPending();
    }, [refreshPending]),
  );

  const handleRetry = () => {
    void (async () => {
      await retryRejected();
      // Show the queue as pending again before the run starts, so the tap has a
      // visible effect even when the server takes its time refusing a second
      // time.
      await refreshPending();
      await sync();
    })();
  };

  const handleSignOut = () => {
    void (async () => {
      // The counts decide the warning and `resetSyncState` drops the whole log
      // moments later, so they are read fresh from the store rather than from
      // the render that opened the alert. Both counts are changes that never
      // reached the account, and sign-out discards them either way, so the
      // warning speaks for both.
      await refreshPending();
      const { pending: queued, rejected: refused } = useSync.getState();
      const unsynced = queued + refused;

      Alert.alert(
        'Sign out',
        unsynced > 0
          ? `${unsynced} change${unsynced === 1 ? '' : 's'} haven't synced yet. They'll stay on this device but won't reach your account.`
          : 'Your workouts stay on this device.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign out',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await authClient.signOut();
                // The cursor belongs to the previous account; keeping it would
                // make the next sign-in start mid-stream and miss rows.
                await resetSyncState();
                markSignedOut();
              })();
            },
          },
        ],
      );
    })();
  };

  if (isPending) {
    return (
      <Card>
        <Text variant="label" color="textTertiary">
          Checking account…
        </Text>
      </Card>
    );
  }

  if (!session?.user) {
    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name="cloud-offline-outline" size={20} color={colors.textSecondary} />
          </View>
          <View style={styles.flex}>
            <Text variant="bodyMedium">Local only</Text>
            <Text variant="caption" color="textTertiary">
              Everything works. Sign in to back up and sync across devices.
            </Text>
          </View>
        </View>
        <Button
          title="Sign in or create account"
          fullWidth
          onPress={() => router.push('/sign-in')}
        />
      </Card>
    );
  }

  const statusColor =
    status === 'error' || status === 'signed-out' || rejected > 0
      ? colors.danger
      : status === 'offline'
        ? colors.warning
        : colors.success;

  const statusLabel = describeStatus(status, pending, rejected);

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.accentSurface }]}>
          <Ionicons name="cloud-done-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {session.user.email}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text variant="caption" color="textTertiary">
              {statusLabel}
            </Text>
          </View>
        </View>
        <IconButton
          name="log-out-outline"
          size={20}
          onPress={handleSignOut}
          accessibilityLabel="Sign out"
        />
      </View>

      {rejected > 0 && (
        <View style={styles.rejected}>
          <Text variant="caption" color="textTertiary">
            {rejectionReason ?? 'The server would not take them.'} They stay on this device.
          </Text>
          <Button
            title="Try these again"
            variant="secondary"
            size="sm"
            onPress={handleRetry}
            disabled={status === 'syncing'}
          />
        </View>
      )}

      {lastError && (
        <Text variant="caption" color="danger">
          {lastError}
        </Text>
      )}

      {lastSyncedAt && (
        <Text variant="caption" color="textTertiary">
          Last synced {new Date(lastSyncedAt).toLocaleTimeString()}
        </Text>
      )}

      <Button
        title="Sync now"
        variant="secondary"
        size="sm"
        fullWidth
        loading={status === 'syncing'}
        onPress={() => void sync()}
      />
    </Card>
  );
}

/**
 * The one line that says whether the account is up to date.
 *
 * Written as statements rather than a ternary chain because of the last one:
 * "All changes synced" is the only claim in this card that can be false in a
 * way the user has no other way to notice, so it is reachable only when both
 * counters are zero. A change the server rejected is still a change that did
 * not sync, and it used to fall through to the reassuring branch.
 */
function describeStatus(status: SyncStatus, pending: number, rejected: number): string {
  if (status === 'syncing') return 'Syncing…';
  if (status === 'signed-out') return 'Session expired';

  if (rejected > 0) {
    // The log keeps only the newest `RETIRED_LIMIT` retired entries, so at the
    // cap the count is a floor rather than a total and has to read as one.
    const count = rejected >= RETIRED_LIMIT ? `${RETIRED_LIMIT}+` : String(rejected);
    return `${count} change${rejected === 1 ? '' : 's'} could not sync`;
  }
  if (status === 'offline') return 'Offline — will retry';
  if (pending > 0) {
    return `${pending} change${pending === 1 ? '' : 's'} pending`;
  }

  return 'All changes synced';
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: 2 },
  rejected: { gap: spacing.sm, alignItems: 'flex-start' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
});
