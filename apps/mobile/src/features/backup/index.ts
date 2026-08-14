/**
 * Backup, export and import.
 *
 * The JSON format is a straight dump of every user-owned table. It is the
 * escape hatch: as long as this exists, nobody's training history is trapped in
 * the app.
 */

import { eq, isNull } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';

import { db } from '@/db/client';
import {
  bodyMeasurements,
  exercises,
  personalRecords,
  routineExercises,
  routineFolders,
  routineSets,
  routines,
  workoutExercises,
  workoutSets,
  workouts,
} from '@/db/schema';

/** Bumped whenever the shape changes incompatibly, so imports can refuse. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: 'ironlog-backup';
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/**
 * Serialises every user table.
 *
 * Built-in exercises are excluded — they ship with the app and re-seed on
 * launch, so including 230 static rows would bloat every backup for nothing.
 * Custom exercises are kept, since routines and history reference them.
 */
export async function buildBackup(): Promise<BackupFile> {
  const [
    customExercises,
    folders,
    routineRows,
    routineExerciseRows,
    routineSetRows,
    workoutRows,
    workoutExerciseRows,
    setRows,
    prRows,
    measurementRows,
  ] = await Promise.all([
    db.select().from(exercises),
    db.select().from(routineFolders),
    db.select().from(routines),
    db.select().from(routineExercises),
    db.select().from(routineSets),
    db.select().from(workouts),
    db.select().from(workoutExercises),
    db.select().from(workoutSets),
    db.select().from(personalRecords),
    db.select().from(bodyMeasurements),
  ]);

  const data: Record<string, unknown[]> = {
    exercises: customExercises.filter((row) => row.isCustom),
    routine_folders: folders,
    routines: routineRows,
    routine_exercises: routineExerciseRows,
    routine_sets: routineSetRows,
    workouts: workoutRows,
    workout_exercises: workoutExerciseRows,
    workout_sets: setRows,
    personal_records: prRows,
    body_measurements: measurementRows,
  };

  return {
    format: 'ironlog-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    data,
  };
}

/** Writes a backup to the cache directory and returns the file for sharing. */
export async function writeBackupFile(): Promise<File> {
  const backup = await buildBackup();

  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ironlog-backup-${stamp}.json`);

  // Overwrite so exporting twice in one day doesn't fail.
  file.create({ overwrite: true });
  file.write(JSON.stringify(backup, null, 2));

  return file;
}

/**
 * Flattens completed workouts into a CSV, one row per set.
 *
 * Long format rather than wide: it's what spreadsheets and R/pandas expect, and
 * it doesn't break when someone logs 12 sets of an exercise.
 */
export async function writeCsvFile(): Promise<File> {
  const rows = await db
    .select({
      workoutName: workouts.name,
      startedAt: workouts.startedAt,
      exerciseName: exercises.name,
      setType: workoutSets.setType,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      rpe: workoutSets.rpe,
      position: workoutSets.position,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
    .where(isNull(workoutSets.deletedAt))
    .orderBy(workouts.startedAt, workoutExercises.position, workoutSets.position);

  const header = [
    'Date',
    'Workout',
    'Exercise',
    'Set Type',
    'Weight (kg)',
    'Reps',
    'Duration (s)',
    'Distance (km)',
    'RPE',
  ];

  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.startedAt.toISOString(),
        csvEscape(row.workoutName),
        csvEscape(row.exerciseName),
        row.setType,
        row.weightKg ?? '',
        row.reps ?? '',
        row.durationSeconds ?? '',
        row.distanceKm ?? '',
        row.rpe ?? '',
      ].join(','),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `ironlog-sets-${stamp}.csv`);
  file.create({ overwrite: true });
  file.write(lines.join('\n'));

  return file;
}

/** Quotes a CSV field when it contains a comma, quote or newline. */
function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: number;
}

/**
 * Restores a backup.
 *
 * Rows are inserted with `onConflictDoNothing`, making the import additive and
 * idempotent — re-importing the same file changes nothing, and importing onto a
 * device that already has data merges rather than destroys. Because IDs are
 * UUIDv7, collisions between genuinely different rows are not a concern.
 */
export async function restoreBackup(json: string): Promise<ImportResult> {
  const parsed = JSON.parse(json) as BackupFile;

  if (parsed.format !== 'ironlog-backup') {
    throw new Error('Not an IronLog backup file.');
  }
  if (parsed.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was made by a newer version of IronLog (format ${parsed.version}). Update the app first.`,
    );
  }

  const tables = [
    ['exercises', exercises],
    ['routine_folders', routineFolders],
    ['routines', routines],
    ['routine_exercises', routineExercises],
    ['routine_sets', routineSets],
    ['workouts', workouts],
    ['workout_exercises', workoutExercises],
    ['workout_sets', workoutSets],
    ['personal_records', personalRecords],
    ['body_measurements', bodyMeasurements],
  ] as const;

  const imported: Record<string, number> = {};
  let skipped = 0;

  // Insert in dependency order so foreign keys always resolve.
  for (const [name, table] of tables) {
    const rows = parsed.data[name];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    let count = 0;
    for (const row of rows) {
      try {
        await db
          .insert(table as never)
          .values(reviveDates(row as Record<string, unknown>) as never)
          .onConflictDoNothing();
        count += 1;
      } catch {
        // A single malformed row shouldn't abort the whole restore.
        skipped += 1;
      }
    }
    imported[name] = count;
  }

  return { imported, skipped };
}

/**
 * JSON has no Date type, so timestamp columns come back as ISO strings.
 * Drizzle's `timestamp_ms` mode expects real Date objects on insert.
 */
const DATE_COLUMNS = new Set([
  'startedAt',
  'finishedAt',
  'completedAt',
  'achievedAt',
  'measuredAt',
  'lastPerformedAt',
]);

function reviveDates(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };

  for (const key of DATE_COLUMNS) {
    const value = result[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      result[key] = Number.isNaN(date.getTime()) ? null : date;
    }
  }

  return result;
}
