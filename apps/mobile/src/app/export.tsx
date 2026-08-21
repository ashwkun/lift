import { File } from 'expo-file-system';
import { Stack, router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, SectionHeader, Text, useScrollEdge } from '@/components/ui';
import { buildBackup, restoreBackup, writeBackupFile, writeCsvFile } from '@/features/backup';
import { showAlert } from '@/store/dialog';
import { spacing } from '@/theme';

type Task = 'json' | 'csv' | 'import';

/**
 * The one line of an unknown failure worth putting in front of someone.
 *
 * File-system and SQLite errors arrive as `Error`s whose message is usually a
 * real sentence — "ENOSPC: no space left on device" — and that sentence is the
 * only thing separating a full disk from a permission problem. Anything that is
 * not an `Error` has no message worth rendering, so it says so plainly rather
 * than printing `[object Object]`.
 */
function reason(cause: unknown): string {
  const text = cause instanceof Error ? cause.message.trim() : '';
  return text.length > 0 ? text : 'The reason was not reported.';
}

/**
 * Backup, export and restore.
 *
 * Written for the bad day rather than the curious one. The active workout
 * screen links here when its writes start failing, because a full disk stops
 * SQLite writing without stopping it reading — so this screen is often the last
 * intact route out of a phone that is already losing sets. That is why the
 * export button sits above everything else, why every failure names what it
 * left untouched, and why the row counts admit when they could not be read
 * instead of painting six confident zeroes.
 */
export default function ExportScreen() {
  const scrollEdge = useScrollEdge();

  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const [busy, setBusy] = useState<Task | null>(null);

  const refreshCounts = useCallback(async () => {
    try {
      const backup = await buildBackup();
      setCounts(backup.counts);
      setCountsFailed(false);
    } catch {
      // The failure is the interesting part on this screen: it is the same read
      // the export itself has to make, so it is reported rather than swallowed.
      setCounts(null);
      setCountsFailed(true);
    }
  }, []);

  // The same read as `refreshCounts`, spelled out here so the state lands in a
  // settled callback rather than in the effect body.
  useEffect(() => {
    let cancelled = false;
    void buildBackup().then(
      (backup) => {
        if (!cancelled) setCounts(backup.counts);
      },
      () => {
        if (!cancelled) setCountsFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const share = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    try {
      const file = kind === 'json' ? await writeBackupFile() : await writeCsvFile();

      if (!(await Sharing.isAvailableAsync())) {
        // The file exists either way, so its path is the only thing left that
        // can get it off the device.
        void showAlert(
          'No share sheet on this device',
          `The file is written and waiting at:\n${file.uri}`,
        );
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: kind === 'json' ? 'application/json' : 'text/csv',
        dialogTitle: kind === 'json' ? 'Lift backup' : 'Lift sets as CSV',
      });
    } catch (error) {
      void showAlert(
        kind === 'json' ? 'Backup not written' : 'CSV not written',
        `${reason(error)}\n\nIf the phone is out of storage, freeing some space and trying again is the fix.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    setBusy('import');
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (picked.canceled) return;

      const contents = await picked.result.text();
      const result = await restoreBackup(contents);

      const total = Object.values(result.imported).reduce((sum, count) => sum + count, 0);
      const lines = [
        total > 0
          ? `${total.toLocaleString()} rows added.`
          : 'Nothing new. This device already held every row in that file.',
      ];
      if (result.skipped > 0) {
        lines.push(`${result.skipped.toLocaleString()} rows were unreadable and left out.`);
      }
      // `queued` is zero while signed out — the oplog entries are written either
      // way, but with no account there is nothing to promise them to.
      if (result.queued > 0) {
        lines.push(`${result.queued.toLocaleString()} are queued for your account.`);
      }

      void showAlert('Restore finished', lines.join('\n\n'));
      await refreshCounts();
    } catch (error) {
      // `restoreBackup` throws in this voice already, and its messages say what
      // survived. The title carries the rest.
      void showAlert('Nothing was restored', reason(error));
    } finally {
      setBusy(null);
    }
  };

  const totalRows = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null;

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Backup & export' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <Text variant="body" color="textSecondary">
          A backup is one JSON file holding every workout, set, routine, record and measurement on
          this phone. Writing it only reads the database, so it still works when writes are failing.
        </Text>

        <Button
          title="Export backup"
          icon="download-outline"
          size="lg"
          fullWidth
          loading={busy === 'json'}
          disabled={busy !== null}
          onPress={() => void share('json')}
        />

        <SectionHeader title="What the file holds" />
        <Card style={styles.card}>
          <Row label="Workouts" value={counts?.workouts ?? null} />
          <Row label="Sets logged" value={counts?.workout_sets ?? null} />
          <Row label="Routines" value={counts?.routines ?? null} />
          <Row label="Custom exercises" value={counts?.exercises ?? null} />
          <Row label="Personal records" value={counts?.personal_records ?? null} />
          <Row label="Measurements" value={counts?.body_measurements ?? null} />
        </Card>

        {countsFailed ? (
          <Text variant="label" color="danger" style={styles.hint}>
            Could not read the database to count rows. Exporting reads the same tables, so it is
            still worth trying — it will say what it finds.
          </Text>
        ) : (
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            Built-in exercises are left out; they ship with the app and come back on install. App
            settings stay behind too — units, rest defaults and the rest belong to this install,
            not to the training log.
          </Text>
        )}

        <SectionHeader title="Spreadsheet copy" />
        <Button
          title="Export sets as CSV"
          icon="grid-outline"
          variant="secondary"
          fullWidth
          loading={busy === 'csv'}
          disabled={busy !== null}
          onPress={() => void share('csv')}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          One row per set, for spreadsheets and analysis. It carries no routines, records or
          measurements, and nothing can be restored from it.
        </Text>

        <SectionHeader title="Restore" />
        <Button
          title="Restore from a backup"
          icon="cloud-upload-outline"
          variant="secondary"
          fullWidth
          loading={busy === 'import'}
          disabled={busy !== null}
          onPress={() => void importBackup()}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Restoring merges into what is already here and overwrites nothing. Importing the same file
          twice changes nothing the second time.
        </Text>

        <Button
          title="Import from another app"
          icon="download-outline"
          variant="ghost"
          fullWidth
          disabled={busy !== null}
          onPress={() => router.push('/import')}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          For a Hevy, Lyfta or Strong export, or a Lift CSV — and for restoring only part of a
          history rather than all of it.
        </Text>

        {totalRows !== null && (
          <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
            {totalRows.toLocaleString()} rows on this device
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * A count of `null` is "not read yet", which is not the same statement as zero.
 * Six confident zeroes on the screen someone reaches because their data is at
 * risk is the worst possible thing for it to say while it is still counting.
 */
function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color="textSecondary">
        {label}
      </Text>
      <Text variant="numeric" color={value === null ? 'textTertiary' : 'text'}>
        {value === null ? '—' : value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { paddingTop: spacing.sm, paddingHorizontal: spacing.xs },
  footer: { marginTop: spacing.xxl },
});
