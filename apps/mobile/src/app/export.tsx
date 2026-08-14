import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, SectionHeader, Text } from '@/components/ui';
import { buildBackup, restoreBackup, writeBackupFile, writeCsvFile } from '@/features/backup';
import { spacing } from '@/theme';

export default function ExportScreen() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void buildBackup().then((backup) => {
      if (!cancelled) setCounts(backup.counts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const share = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    try {
      const file = kind === 'json' ? await writeBackupFile() : await writeCsvFile();

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', `File written to:\n${file.uri}`);
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: kind === 'json' ? 'application/json' : 'text/csv',
        dialogTitle: kind === 'json' ? 'Export IronLog backup' : 'Export sets as CSV',
      });
    } catch (error) {
      Alert.alert('Export failed', (error as Error).message);
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
      Alert.alert(
        'Import complete',
        `${total} rows imported.${result.skipped > 0 ? `\n${result.skipped} rows skipped.` : ''}`,
      );

      setCounts((await buildBackup()).counts);
    } catch (error) {
      Alert.alert('Import failed', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const totalRows = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Backup & Export' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Your Data" />
        <Card style={styles.card}>
          <Row label="Workouts" value={counts.workouts ?? 0} />
          <Row label="Sets logged" value={counts.workout_sets ?? 0} />
          <Row label="Routines" value={counts.routines ?? 0} />
          <Row label="Custom exercises" value={counts.exercises ?? 0} />
          <Row label="Personal records" value={counts.personal_records ?? 0} />
          <Row label="Measurements" value={counts.body_measurements ?? 0} />
        </Card>

        <SectionHeader title="Export" />
        <View style={styles.actions}>
          <Button
            title="Export Backup (JSON)"
            icon="download-outline"
            fullWidth
            loading={busy === 'json'}
            disabled={busy !== null}
            onPress={() => void share('json')}
          />
          <Button
            title="Export Sets (CSV)"
            icon="grid-outline"
            variant="secondary"
            fullWidth
            loading={busy === 'csv'}
            disabled={busy !== null}
            onPress={() => void share('csv')}
          />
        </View>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          JSON restores everything. CSV is one row per set — for spreadsheets and analysis, not for
          restoring.
        </Text>

        <SectionHeader title="Import" />
        <Button
          title="Restore from Backup"
          icon="cloud-upload-outline"
          variant="secondary"
          fullWidth
          loading={busy === 'import'}
          disabled={busy !== null}
          onPress={() => void importBackup()}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Importing merges into your existing data and never overwrites it. Re-importing the same
          file has no effect.
        </Text>

        <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
          {totalRows.toLocaleString()} rows on this device
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color="textSecondary">
        {label}
      </Text>
      <Text variant="numeric">{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { gap: spacing.sm },
  hint: { paddingTop: spacing.sm, paddingHorizontal: spacing.xs },
  footer: { marginTop: spacing.xxl },
});
