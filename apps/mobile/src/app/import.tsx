import { Ionicons } from '@expo/vector-icons';
import { formatWeight, type WeightUnit } from '@lift/shared';
import { IMPORT_RANGES, importCutoff, type ImportRange } from '@lift/shared/import';
import { File } from 'expo-file-system';
import { Stack, router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  ListPicker,
  ListRow,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { restoreBackup } from '@/features/backup';
import {
  EXPORT_GUIDES,
  IMPORT_APP_ORDER,
  importWorkouts,
  newExercisesIn,
  readImportFile,
  selectRange,
  type ImportApp,
  type ImportPreview,
  type ImportSummary,
  type RangeSelection,
  type WorkoutsPreview,
} from '@/features/import';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/**
 * Bringing training history in from another app.
 *
 * The screen is one scroll with four states, in the order the task actually
 * happens: pick the app you're leaving, get the file out of it, see what the
 * file holds, then decide how much of it to keep. The order matters — the
 * export instructions sit above the file picker because that is where someone
 * is stuck, and the counts sit above the import button because agreeing to
 * "import 240 workouts" is the one moment they can still change their mind.
 *
 * Nothing is written until the last tap. Everything above it — the parse, the
 * duplicate check, the list of exercises that would be created — is a read.
 */
export default function ImportScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);

  const [app, setApp] = useState<ImportApp | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [unit, setUnit] = useState<WeightUnit>(weightUnit);
  const [range, setRange] = useState<ImportRange>('all');

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [restored, setRestored] = useState<number | null>(null);

  /**
   * Discards the answer to a read that has since been superseded.
   *
   * Two reads can be in flight at once — pick a file, then change the unit
   * before the first parse returns — and they finish in whatever order they
   * finish in. Without this the slower one wins and the screen shows a preview
   * of the unit the user just moved away from.
   */
  const readToken = useRef(0);

  /**
   * Reads a file into a preview.
   *
   * Driven from the taps that cause it rather than from an effect on `unit`:
   * the unit is an *input to the parse*, not a display setting — weights are
   * stored in kilograms, so choosing pounds has to go back through the file —
   * and an effect would make that a synchronisation of state with itself.
   */
  const loadPreview = useCallback(async (text: string, assumedUnit: WeightUnit) => {
    const token = ++readToken.current;

    setReading(true);
    setError(null);

    try {
      const next = await readImportFile(text, { weightUnit: assumedUnit });
      if (token !== readToken.current) return;
      setPreview(next);
    } catch (cause) {
      if (token !== readToken.current) return;
      setPreview(null);
      setError(describe(cause));
    } finally {
      if (token === readToken.current) setReading(false);
    }
  }, []);

  const pickFile = useCallback(async () => {
    if (!app) return;

    try {
      const picked = await File.pickFileAsync({ mimeTypes: EXPORT_GUIDES[app].mimeTypes });
      if (picked.canceled) return;

      const text = await picked.result.text();

      setSummary(null);
      setRestored(null);
      setFile({ name: picked.result.name, text });
      await loadPreview(text, unit);
    } catch (cause) {
      void showAlert('Could not open that file', describe(cause));
    }
  }, [app, loadPreview, unit]);

  const changeUnit = useCallback(
    (next: WeightUnit) => {
      setUnit(next);
      if (file) void loadPreview(file.text, next);
    },
    [file, loadPreview],
  );

  const selection = useMemo(() => {
    if (preview?.kind !== 'workouts') return null;
    return selectRange(preview.parsed, importCutoff(range));
  }, [preview, range]);

  const newExercises = useMemo(() => {
    if (preview?.kind !== 'workouts' || !selection) return [];
    return newExercisesIn(preview, selection.workouts);
  }, [preview, selection]);

  const runImport = async () => {
    if (!selection || selection.workouts.length === 0) return;

    setBusy(true);
    setProgress({ done: 0, total: selection.workouts.length });

    try {
      const result = await importWorkouts(selection.workouts, {
        // Throttled: a per-workout render on a thousand-session import spends
        // more time laying out a number than writing rows.
        onProgress: (next) => {
          if (next.done % 5 === 0 || next.done === next.total) setProgress(next);
        },
      });
      setSummary(result);
    } catch (cause) {
      void showAlert('Import stopped', describe(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runRestore = async () => {
    if (preview?.kind !== 'backup') return;

    setBusy(true);
    try {
      const result = await restoreBackup(preview.json);
      setRestored(Object.values(result.imported).reduce((total, count) => total + count, 0));
    } catch (cause) {
      void showAlert('Nothing was restored', describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    // Bumped so a read still in flight cannot repopulate the screen the user
    // just cleared.
    readToken.current += 1;

    setFile(null);
    setPreview(null);
    setSummary(null);
    setRestored(null);
    setError(null);
    setReading(false);
    setRange('all');
  };

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Import' }} />

      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {summary !== null ? (
          <ImportResult summary={summary} onImportMore={startOver} />
        ) : restored !== null ? (
          <RestoreResult rows={restored} onImportMore={startOver} />
        ) : (
          <>
            <SourceStep app={app} onPick={setApp} onReset={startOver} />

            {app && !file && <ExportGuideCard app={app} onPickFile={() => void pickFile()} />}

            {file && (
              <FileStep
                name={file.name}
                reading={reading}
                error={error}
                onReplace={() => void pickFile()}
              />
            )}

            {preview?.kind === 'backup' && (
              <BackupStep
                preview={preview}
                busy={busy}
                onRestore={() => void runRestore()}
              />
            )}

            {preview?.kind === 'workouts' && selection && (
              <WorkoutsStep
                preview={preview}
                selection={selection}
                newExercises={newExercises}
                range={range}
                onRangeChange={setRange}
                unit={unit}
                onUnitChange={changeUnit}
                busy={busy}
                progress={progress}
                onImport={() => void runImport()}
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function SourceStep({
  app,
  onPick,
  onReset,
}: {
  app: ImportApp | null;
  onPick: (app: ImportApp | null) => void;
  onReset: () => void;
}) {
  if (app) {
    const guide = EXPORT_GUIDES[app];
    return (
      <>
        <SectionHeader title="Importing from" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon={guide.icon}
            title={guide.name}
            subtitle={guide.summary}
            showChevron={false}
            accessory={
              <Text variant="label" color="accent">
                Change
              </Text>
            }
            onPress={() => {
              onReset();
              onPick(null);
            }}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Text variant="body" color="textSecondary" style={styles.intro}>
        Bring your training history across. Nothing is written until you say so, and importing the
        same file twice adds nothing the second time.
      </Text>

      <SectionHeader title="Where is it coming from?" />
      <Card padded={false} style={styles.section}>
        {IMPORT_APP_ORDER.map((key, index) => {
          const guide = EXPORT_GUIDES[key];
          return (
            <View key={key}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <ListRow
                icon={guide.icon}
                title={guide.name}
                subtitle={guide.summary}
                onPress={() => onPick(key)}
              />
            </View>
          );
        })}
      </Card>
    </>
  );
}

function ExportGuideCard({ app, onPickFile }: { app: ImportApp; onPickFile: () => void }) {
  const colors = useColors();
  const guide = EXPORT_GUIDES[app];

  return (
    <>
      <SectionHeader title={`Getting the file out of ${guide.name}`} />
      <Card style={styles.card}>
        {guide.steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <Text variant="numeric" color="textTertiary" style={styles.stepNumber}>
              {index + 1}
            </Text>
            <Text variant="body" color="textSecondary" style={styles.stepBody}>
              {step}
            </Text>
          </View>
        ))}
      </Card>

      {guide.warnings.map((warning) => (
        <View key={warning} style={styles.warning}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.textTertiary} />
          <Text variant="caption" color="textTertiary" style={styles.warningBody}>
            {warning}
          </Text>
        </View>
      ))}

      <Button
        title="Choose file"
        icon="folder-open-outline"
        size="lg"
        fullWidth
        style={styles.action}
        onPress={onPickFile}
      />
    </>
  );
}

function FileStep({
  name,
  reading,
  error,
  onReplace,
}: {
  name: string;
  reading: boolean;
  error: string | null;
  onReplace: () => void;
}) {
  return (
    <>
      <SectionHeader title="File" />
      <Card padded={false} style={styles.section}>
        <ListRow
          icon="document-text-outline"
          title={name}
          subtitle={reading ? 'Reading…' : undefined}
          showChevron={false}
          accessory={
            reading ? (
              <ActivityIndicator />
            ) : (
              <Text variant="label" color="accent">
                Replace
              </Text>
            )
          }
          onPress={reading ? undefined : onReplace}
        />
      </Card>

      {error && (
        <Text variant="body" color="danger" style={styles.hint}>
          {error}
        </Text>
      )}
    </>
  );
}

function BackupStep({
  preview,
  busy,
  onRestore,
}: {
  preview: Extract<ImportPreview, { kind: 'backup' }>;
  busy: boolean;
  onRestore: () => void;
}) {
  const { counts, exportedAt } = preview.file;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <SectionHeader title="This is a Lift backup" />
      <Card style={styles.card}>
        <Figure label="Workouts" value={counts.workouts ?? 0} />
        <Figure label="Sets" value={counts.workout_sets ?? 0} />
        <Figure label="Routines" value={counts.routines ?? 0} />
        <Figure label="Custom exercises" value={counts.exercises ?? 0} />
        <Figure label="Records" value={counts.personal_records ?? 0} />
        <Figure label="Measurements" value={counts.body_measurements ?? 0} />
      </Card>

      <Text variant="caption" color="textTertiary" style={styles.hint}>
        {exportedAt ? `Exported ${formatDate(new Date(exportedAt))}. ` : ''}
        A backup carries routines, records and measurements as well as workouts, so it restores
        whole rather than by date. It merges into what is here and overwrites nothing.
      </Text>

      <Button
        title={`Restore ${total.toLocaleString()} rows`}
        icon="cloud-upload-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy}
        style={styles.action}
        onPress={onRestore}
      />
    </>
  );
}

function WorkoutsStep({
  preview,
  selection,
  newExercises,
  range,
  onRangeChange,
  unit,
  onUnitChange,
  busy,
  progress,
  onImport,
}: {
  preview: WorkoutsPreview;
  selection: RangeSelection;
  newExercises: string[];
  range: ImportRange;
  onRangeChange: (range: ImportRange) => void;
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  busy: boolean;
  progress: { done: number; total: number } | null;
  onImport: () => void;
}) {
  const parsed = preview.parsed;
  const diagnostics = parsed.diagnostics;

  // Walks every set in the file, so it is kept off the range picker's path.
  const heaviestKg = useMemo(() => heaviest(preview), [preview]);

  const chosenCount = selection.workouts.length;
  const alreadyHere = preview.alreadyPresent;

  return (
    <>
      <SectionHeader title={`Read as a ${preview.sourceLabel} export`} />
      <Card style={styles.card}>
        <Figure label="Workouts in the file" value={parsed.workouts.length} />
        <Figure label="Sets" value={parsed.setCount} />
        {preview.span && (
          <Row
            label="Covering"
            value={`${formatDate(preview.span.from)} – ${formatDate(preview.span.to)}`}
          />
        )}
        {alreadyHere > 0 && (
          <Row
            label="Already in your log"
            value={`${alreadyHere.toLocaleString()}, skipped`}
          />
        )}
      </Card>

      <SectionHeader title="How far back" />
      <ListPicker
        label="Import from"
        options={IMPORT_RANGES}
        value={range}
        onChange={onRangeChange}
      />
      <Text variant="caption" color="textTertiary" style={styles.hint}>
        {chosenCount === 0
          ? 'Nothing in the file falls in that window.'
          : `${chosenCount.toLocaleString()} ${chosenCount === 1 ? 'workout' : 'workouts'} and ${selection.sets.toLocaleString()} sets are in range. Any already in your log are skipped.`}
      </Text>

      {diagnostics.weightUnitSource === 'chosen' && (
        <>
          <SectionHeader title="Weights" />
          <Text variant="body" color="textSecondary" style={styles.hint}>
            The file does not say what unit its weights are in. Read them as:
          </Text>
          <SegmentedControl
            options={[
              { value: 'kg', label: 'Kilograms' },
              { value: 'lb', label: 'Pounds' },
            ]}
            value={unit}
            onChange={onUnitChange}
            style={styles.unit}
          />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            Getting this wrong is not subtle — the heaviest set in the file would come in as{' '}
            {formatWeight(heaviestKg, unit)}.
          </Text>
        </>
      )}

      {newExercises.length > 0 && (
        <>
          <SectionHeader title={`${newExercises.length} new exercises`} />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            These are not in your library and will be added to it: {list(newExercises)}. They come
            in with no muscle set, so the body map will not count them until you fill that in.
          </Text>
        </>
      )}

      <Skipped diagnostics={diagnostics} />

      {progress && (
        <Text variant="caption" color="textTertiary" align="center" style={styles.hint}>
          {progress.done.toLocaleString()} of {progress.total.toLocaleString()} workouts
        </Text>
      )}

      <Button
        title={
          chosenCount === 0
            ? 'Nothing to import'
            : `Import ${chosenCount.toLocaleString()} ${chosenCount === 1 ? 'workout' : 'workouts'}`
        }
        icon="download-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy || chosenCount === 0}
        style={styles.action}
        onPress={onImport}
      />
    </>
  );
}

/**
 * What the parser could not use.
 *
 * Rendered even though every line here is a small number, because these are the
 * rows that will be missing afterwards. Finding out that a hundred sets were
 * dropped by noticing a gap in a chart six weeks later is the outcome this
 * paragraph exists to prevent.
 */
function Skipped({ diagnostics }: { diagnostics: WorkoutsPreview['parsed']['diagnostics'] }) {
  const lines: string[] = [];

  if (diagnostics.undatedRows > 0) {
    lines.push(
      `${diagnostics.undatedRows.toLocaleString()} rows had no readable date and were left out. If the source app is not set to English, its month names will not be recognised.`,
    );
  }
  if (diagnostics.blankRows > 0) {
    lines.push(
      `${diagnostics.blankRows.toLocaleString()} rows recorded no weight, reps, duration or distance, so nothing was performed on them.`,
    );
  }

  const coerced = Object.entries(diagnostics.coercedSetTypes);
  if (coerced.length > 0) {
    const total = coerced.reduce((sum, [, count]) => sum + count, 0);
    lines.push(
      `${total.toLocaleString()} sets were labelled ${list(coerced.map(([label]) => label))}, which Lift has no equivalent for. They come in as normal sets and still count toward your volume.`,
    );
  }

  if (diagnostics.unnamedRows > 0) {
    lines.push(
      `${diagnostics.unnamedRows.toLocaleString()} rows named no exercise and were left out.`,
    );
  }

  if (lines.length === 0) return null;

  return (
    <>
      <SectionHeader title="Left out" />
      {lines.map((line) => (
        <Text key={line} variant="caption" color="textTertiary" style={styles.hint}>
          {line}
        </Text>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ImportResult({
  summary,
  onImportMore,
}: {
  summary: ImportSummary;
  onImportMore: () => void;
}) {
  const nothing = summary.workouts === 0;

  return (
    <>
      <SectionHeader title={nothing ? 'Nothing new' : 'Imported'} />
      <Card style={styles.card}>
        <Figure label="Workouts added" value={summary.workouts} />
        <Figure label="Sets" value={summary.sets} />
        {summary.personalRecords > 0 && (
          <Figure label="Records found" value={summary.personalRecords} />
        )}
        {summary.exercisesCreated.length > 0 && (
          <Figure label="Exercises added" value={summary.exercisesCreated.length} />
        )}
        {summary.duplicates > 0 && <Figure label="Already here" value={summary.duplicates} />}
      </Card>

      {nothing && summary.duplicates > 0 && (
        <Text variant="body" color="textSecondary" style={styles.hint}>
          Every workout in that range was already in your log, so nothing changed.
        </Text>
      )}

      {summary.failed > 0 && (
        <Text variant="body" color="danger" style={styles.hint}>
          {summary.failed.toLocaleString()}{' '}
          {summary.failed === 1 ? 'session' : 'sessions'} could not be written and were rolled
          back. Everything else landed — importing the same file again will pick up only what is
          missing. If the phone is out of storage, freeing some space first is the fix.
        </Text>
      )}

      {summary.queued > 0 && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          {summary.queued.toLocaleString()} rows are queued for your account and will sync.
        </Text>
      )}

      {summary.personalRecords > 0 && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Records were awarded oldest first and dated to the day they were set, so your progress
          charts read the way they did in the app you left.
        </Text>
      )}

      <View style={styles.actions}>
        <Button
          title="View history"
          icon="time-outline"
          size="lg"
          fullWidth
          onPress={() => router.replace('/history')}
        />
        <Button title="Import another file" variant="secondary" fullWidth onPress={onImportMore} />
      </View>
    </>
  );
}

function RestoreResult({ rows, onImportMore }: { rows: number; onImportMore: () => void }) {
  return (
    <>
      <SectionHeader title={rows > 0 ? 'Restored' : 'Nothing new'} />
      <Text variant="body" color="textSecondary" style={styles.hint}>
        {rows > 0
          ? `${rows.toLocaleString()} rows added.`
          : 'This device already held every row in that backup.'}
      </Text>

      <View style={styles.actions}>
        <Button
          title="View history"
          icon="time-outline"
          size="lg"
          fullWidth
          onPress={() => router.replace('/history')}
        />
        <Button title="Import another file" variant="secondary" fullWidth onPress={onImportMore} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Figure({ label, value }: { label: string; value: number }) {
  return <Row label={label} value={value.toLocaleString()} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color="textSecondary" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="numeric" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The heaviest set in the file, which is what makes a unit mix-up obvious. */
function heaviest(preview: WorkoutsPreview): number {
  let best = 0;
  for (const workout of preview.parsed.workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) best = Math.max(best, set.weightKg ?? 0);
    }
  }
  return best;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "a, b and c", capped so a hundred new exercises don't fill the screen. */
function list(items: readonly string[], limit = 6): string {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;

  const joined =
    shown.length <= 1
      ? (shown[0] ?? '')
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;

  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : joined;
}

/**
 * The one line of a failure worth putting in front of someone.
 *
 * `ImportFormatError` arrives already written for the user — it names the
 * column that is missing — and the file-system and SQLite errors behind
 * everything else carry a real sentence of their own ("ENOSPC: no space left on
 * device"), which is the only thing separating a full disk from a permission
 * problem. Anything with no message says so rather than rendering
 * `[object Object]`.
 */
function describe(cause: unknown): string {
  const text = cause instanceof Error ? cause.message.trim() : '';
  return text.length > 0 ? text : 'The reason was not reported.';
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
  intro: { paddingBottom: spacing.sm },
  section: { marginTop: spacing.xs },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  rowLabel: { flexShrink: 1 },
  step: { flexDirection: 'row', gap: spacing.md },
  stepNumber: { width: 18, textAlign: 'right' },
  stepBody: { flex: 1 },
  warning: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  warningBody: { flex: 1 },
  hint: { paddingTop: spacing.xs, paddingHorizontal: spacing.xs },
  unit: { marginTop: spacing.xs },
  action: { marginTop: spacing.lg },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
