import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useSync } from '@/store/sync';
import { radius, spacing, useColors } from '@/theme';

import { authClient, useSession } from './auth-client';
import { resetSyncState } from './engine';

/**
 * Account and sync status.
 *
 * Signed out is a completely valid state — the app is local-first, and this is
 * framed as an optional backup rather than a wall in front of the product.
 */
export function SyncCard() {
  const colors = useColors();
  const { data: session, isPending } = useSession();

  const { status, lastSyncedAt, lastError, pending, sync, refreshPending, markSignedOut } =
    useSync();

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      pending > 0
        ? `${pending} change${pending === 1 ? '' : 's'} haven't synced yet. They'll stay on this device but won't reach your account.`
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
        <Button title="Sign In or Create Account" fullWidth onPress={() => router.push('/sign-in')} />
      </Card>
    );
  }

  const statusColor =
    status === 'error' || status === 'signed-out'
      ? colors.danger
      : status === 'offline'
        ? colors.warning
        : colors.success;

  const statusLabel =
    status === 'syncing'
      ? 'Syncing…'
      : status === 'offline'
        ? 'Offline — will retry'
        : status === 'signed-out'
          ? 'Session expired'
          : pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} pending`
            : 'All changes synced';

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
        <Pressable onPress={handleSignOut} hitSlop={8} accessibilityLabel="Sign out">
          <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

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
        title="Sync Now"
        variant="secondary"
        size="sm"
        fullWidth
        loading={status === 'syncing'}
        onPress={() => void sync()}
      />
    </Card>
  );
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
});
