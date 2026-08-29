/**
 * Turning a flat export into sessions.
 *
 * Every app exports the same shape: one row per set, with the workout it
 * belongs to repeated on each row. Rebuilding the nesting is most of the work
 * here, and the rest is deciding what a row *doesn't* say: a missing end time,
 * an absent unit, a set type Lift has no name for.
 *
 * Nothing in this file touches a database. It is pure so it can be tested
 * against real export files, and so the import screen can show the user what a
 * file contains before anything is written.
 */

import type { DistanceUnit, SetType, WeightUnit } from '../types.ts';
import { fromDisplayDistance, fromDisplayWeight } from '../units.ts';
import { parseCsv } from './csv.ts';
import {
  detectSource,
  resolveColumns,
  type ImportSource,
  type ResolvedColumns,
} from './columns.ts';
import {
  detectDateOrder,
  parseInteger,
  parseNumber,
  parseRpe,
  parseSeconds,
  parseSetType,
  parseTimestamp,
  rirToRpe,
  type DateOrder,
} from './values.ts';

// ---------------------------------------------------------------------------
// The shape an import produces
// ---------------------------------------------------------------------------

export interface ImportedSet {
  setType: SetType;
  /** Always kilograms, whatever the file was written in. */
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  rpe: number | null;
}

export interface ImportedExercise {
  /** As the source spelled it. Matching against the library happens on-device. */
  name: string;
  notes: string | null;
  /** Exercises sharing a number were performed as a superset. */
  supersetGroup: number | null;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  /** Empty when the file carries no title; the importer names it. */
  name: string;
  notes: string | null;
  startedAt: number;
  /**
   * Never null, even when the file doesn't say.
   *
   * A workout with no `finishedAt` is what Lift calls the *active session*.
   * Importing one would have the app reopen a workout from 2023 the next time
   * it launched. So when a file gives no end at all this is `startedAt` plus
   * whatever `resolveEnd` could work out, and in the one case where it can
   * work out nothing (a session with no sets) it equals `startedAt` exactly.
   */
  finishedAt: number;
  /**
   * How long the session ran, from the file where it says so and from the set
   * count where it does not. Null only when there is nothing to count.
   *
   * See `resolveEnd` for the order those are tried in and for why an estimate
   * is preferred to a null here while a set's own weight is never invented.
   */
  durationSeconds: number | null;
  exercises: ImportedExercise[];
}

export interface ImportDiagnostics {
  totalRows: number;
  /** Rows whose date could not be read. Excluded entirely. */
  undatedRows: number;
  /** Rows naming no exercise. Excluded entirely. */
  unnamedRows: number;
  /** Rows with no weight, reps, duration or distance: planned but never done. */
  blankRows: number;
  /** Labels Lift has no equivalent for, and how many sets wore each. */
  coercedSetTypes: Record<string, number>;
  weightUnit: WeightUnit;
  /** `header` when the file said so, `column` per row, `chosen` when the user did. */
  weightUnitSource: 'header' | 'column' | 'chosen';
  distanceUnit: DistanceUnit;
  dateOrder: DateOrder;
}

export interface ParsedImport {
  source: ImportSource;
  columns: ResolvedColumns;
  /** Oldest first, which is the order records have to be awarded in. */
  workouts: ImportedWorkout[];
  diagnostics: ImportDiagnostics;
  setCount: number;
}

export interface ParseOptions {
  /** Used only when neither the header nor a unit column settles it. */
  weightUnit?: WeightUnit;
  distanceUnit?: DistanceUnit;
}

/**
 * Thrown when the file cannot be an export of anything.
 *
 * The message is the one the user reads, so it names the column that is missing
 * rather than talking about parse failures: with no exercise name and no date
 * there is nothing to fix by trying again.
 */
export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/** A session longer than this is a misread end time, not a training day. */
const MAX_SESSION_SECONDS = 24 * 60 * 60;

export function parseWorkoutCsv(text: string, options: ParseOptions = {}): ParsedImport {
  const table = parseCsv(text);

  if (table.header.length === 0 || table.rows.length === 0) {
    throw new ImportFormatError('That file has no rows in it.');
  }

  const columns = resolveColumns(table.header);
  const at = columns.index;

  if (at.exercise === -1) {
    throw new ImportFormatError(
      'No exercise column found. An export needs one column naming the exercise for each set.',
    );
  }
  if (at.startTime === -1) {
    throw new ImportFormatError(
      'No date column found. Without one there is no way to place these workouts in your log.',
    );
  }

  const cell = (row: string[], column: number): string =>
    column === -1 ? '' : (row[column] ?? '').trim();

  const dateOrder = detectDateOrder(table.rows.map((row) => cell(row, at.startTime)));

  // Header first: `weight_kg` is a statement about the values below it and
  // outranks whatever the user picked, because they picked it before seeing
  // the file. A per-row unit column beats both, and is read row by row.
  const perRowUnit = at.weightUnit !== -1;
  const weightUnit = columns.weightUnit ?? options.weightUnit ?? 'kg';
  const weightUnitSource: ImportDiagnostics['weightUnitSource'] = perRowUnit
    ? 'column'
    : columns.weightUnit
      ? 'header'
      : 'chosen';

  const distanceUnit = columns.distanceUnit ?? options.distanceUnit ?? 'km';

  const diagnostics: ImportDiagnostics = {
    totalRows: table.rows.length,
    undatedRows: 0,
    unnamedRows: 0,
    blankRows: 0,
    coercedSetTypes: {},
    weightUnit,
    weightUnitSource,
    distanceUnit,
    dateOrder,
  };

  const drafts = new Map<string, WorkoutDraft>();

  table.rows.forEach((row, rowNumber) => {
    const startedAt = parseTimestamp(cell(row, at.startTime), dateOrder);
    if (startedAt === null) {
      diagnostics.undatedRows += 1;
      return;
    }

    const exerciseName = cell(row, at.exercise);
    if (!exerciseName) {
      diagnostics.unnamedRows += 1;
      return;
    }

    const rowWeightUnit = perRowUnit ? readUnit(cell(row, at.weightUnit), weightUnit) : weightUnit;
    const rowDistanceUnit = at.distanceUnit === -1
      ? distanceUnit
      : readDistanceUnit(cell(row, at.distanceUnit), distanceUnit);

    const weight = parseNumber(cell(row, at.weight));
    const reps = parseInteger(cell(row, at.reps));
    const durationSeconds = parseSeconds(cell(row, at.setDuration));
    const distance = parseNumber(cell(row, at.distance));

    // Nothing was performed here. Exports include these. A planned set left
    // unticked, a placeholder row, and importing them would add sets that
    // never happened to the volume of workouts that did.
    if (weight === null && reps === null && durationSeconds === null && distance === null) {
      diagnostics.blankRows += 1;
      return;
    }

    const rawSetType = cell(row, at.setType);
    const setType = parseSetType(rawSetType);
    if (!setType.exact) {
      const label = rawSetType.trim();
      diagnostics.coercedSetTypes[label] = (diagnostics.coercedSetTypes[label] ?? 0) + 1;
    }

    const title = cell(row, at.workoutTitle);
    const key = `${startedAt}\0${title}`;

    let workout = drafts.get(key);
    if (!workout) {
      workout = {
        startedAt,
        name: title,
        notes: cell(row, at.workoutNotes) || null,
        endedAt: parseTimestamp(cell(row, at.endTime), dateOrder),
        durationSeconds: parseSeconds(cell(row, at.workoutDuration)),
        exercises: new Map(),
      };
      drafts.set(key, workout);
    }

    // Merged by name rather than by run of adjacent rows. An exercise that
    // appears twice in a session: the far side of a superset, or a lift come
    // back to at the end. Is one block of sets in Lift, and splitting it would
    // halve every per-exercise total the app derives.
    const exerciseKey = exerciseName.toLowerCase();
    let exercise = workout.exercises.get(exerciseKey);
    if (!exercise) {
      exercise = {
        name: exerciseName,
        notes: cell(row, at.exerciseNotes) || null,
        supersetId: cell(row, at.supersetId) || null,
        rows: [],
      };
      workout.exercises.set(exerciseKey, exercise);
    }

    exercise.rows.push({
      fileOrder: rowNumber,
      setIndex: parseInteger(cell(row, at.setIndex)),
      set: {
        setType: setType.type,
        weightKg: weight === null ? null : round(fromDisplayWeight(weight, rowWeightUnit), 4),
        reps,
        durationSeconds,
        distanceKm:
          distance === null ? null : round(fromDisplayDistance(distance, rowDistanceUnit), 5),
        rpe: readEffort(cell(row, at.rpe), cell(row, at.rir)),
      },
    });
  });

  const workouts = [...drafts.values()]
    .map(finalize)
    .sort((a, b) => a.startedAt - b.startedAt);

  return {
    source: detectSource(table.header),
    columns,
    workouts,
    diagnostics,
    setCount: workouts.reduce(
      (total, workout) =>
        total + workout.exercises.reduce((sets, exercise) => sets + exercise.sets.length, 0),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

interface SetRow {
  fileOrder: number;
  setIndex: number | null;
  set: ImportedSet;
}

interface ExerciseDraft {
  name: string;
  notes: string | null;
  supersetId: string | null;
  rows: SetRow[];
}

interface WorkoutDraft {
  startedAt: number;
  name: string;
  notes: string | null;
  endedAt: number | null;
  durationSeconds: number | null;
  exercises: Map<string, ExerciseDraft>;
}

function finalize(draft: WorkoutDraft): ImportedWorkout {
  const exercises = [...draft.exercises.values()];

  // Only ids shared by two or more exercises are a superset. A lone id is what
  // an exporter writes for an exercise that happens to have a group column,
  // and rendering that as a one-exercise superset would draw a bracket around
  // a single row.
  const idCounts = new Map<string, number>();
  for (const exercise of exercises) {
    if (exercise.supersetId === null) continue;
    idCounts.set(exercise.supersetId, (idCounts.get(exercise.supersetId) ?? 0) + 1);
  }

  const groupNumbers = new Map<string, number>();
  let setCount = 0;
  for (const exercise of exercises) {
    setCount += exercise.rows.length;
    const id = exercise.supersetId;
    if (id === null || (idCounts.get(id) ?? 0) < 2 || groupNumbers.has(id)) continue;
    groupNumbers.set(id, groupNumbers.size);
  }

  const { finishedAt, durationSeconds } = resolveEnd(draft, setCount);

  return {
    name: draft.name,
    notes: draft.notes,
    startedAt: draft.startedAt,
    finishedAt,
    durationSeconds,
    exercises: exercises.map((exercise) => ({
      name: exercise.name,
      notes: exercise.notes,
      supersetGroup:
        exercise.supersetId === null ? null : (groupNumbers.get(exercise.supersetId) ?? null),
      sets: orderSets(exercise.rows).map((row) => row.set),
    })),
  };
}

/**
 * File order, unless the file numbered its sets.
 *
 * Both matter and neither is reliable alone: a set index puts a warm-up back in
 * front of the working sets when a spreadsheet has been sorted by weight, while
 * file order is the only thing left when the column is missing or partly blank.
 * A partly-numbered exercise keeps file order rather than interleaving the two.
 */
function orderSets(rows: SetRow[]): SetRow[] {
  const numbered = rows.every((row) => row.setIndex !== null);
  if (!numbered) return rows;

  return [...rows].sort((a, b) => a.setIndex! - b.setIndex! || a.fileOrder - b.fileOrder);
}

/**
 * How long a set is assumed to take when the file will not say.
 *
 * 2.5 minutes: a working set and the rest after it. Named rather than inlined
 * because it is the one number in this file that is a guess about human
 * behaviour rather than a reading of the data, and it should be obvious where
 * to change it.
 */
const SECONDS_PER_SET = 150;

function resolveEnd(draft: WorkoutDraft, setCount: number): { finishedAt: number; durationSeconds: number | null } {
  if (draft.endedAt !== null) {
    const seconds = Math.round((draft.endedAt - draft.startedAt) / 1000);
    if (seconds > 0 && seconds <= MAX_SESSION_SECONDS) {
      return { finishedAt: draft.endedAt, durationSeconds: seconds };
    }
  }

  if (draft.durationSeconds !== null && draft.durationSeconds > 0) {
    const seconds = Math.min(draft.durationSeconds, MAX_SESSION_SECONDS);
    return { finishedAt: draft.startedAt + seconds * 1000, durationSeconds: seconds };
  }

  /*
   * Nothing in the file says how long it ran, so it is estimated from the set
   * count at 2.5 minutes a set.
   *
   * Strong is the case that needs it: its export has a row per set and no end
   * time anywhere, so every session it produced used to import as a workout of
   * no length. That is not a neutral outcome. Duration is one of the three
   * metrics Home and History plot, and a year of imported training reading as
   * zero hours makes the chart wrong rather than empty.
   *
   * ## Why this is invented where a set's weight is not
   *
   * The file next to this one refuses to guess a missing weight, and the two
   * are not in tension. A set's weight is a *fact about what happened* that
   * only the lifter knows, and a wrong one silently corrupts an estimated 1RM
   * and a personal record. A session's length is an interval between two
   * timestamps, and 2.5 minutes a set is a defensible reading of the same rows
   * the file does give. It also cannot mislead in the same way: nothing in the
   * app treats an imported duration as a record.
   *
   * Anything that *can* be read is read first: an explicit end time, then an
   * explicit duration column. This is the last resort, and it is bounded by
   * `MAX_SESSION_SECONDS` like the two above it.
   */
  const estimatedSeconds = setCount * SECONDS_PER_SET;
  if (estimatedSeconds > 0 && estimatedSeconds <= MAX_SESSION_SECONDS) {
    return { finishedAt: draft.startedAt + estimatedSeconds * 1000, durationSeconds: estimatedSeconds };
  }

  /*
   * A guard rather than a state anything reaches.
   *
   * A draft is only created by a row that recorded something, so every workout
   * arriving here has at least one set and the estimate above always returns.
   * This is what the type still allows and what a future caller with a
   * zero-set draft would get: `finishedAt` a number, because a null one is the
   * active session, and a null duration, because inventing one from no sets
   * would be a guess about nothing.
   */
  return { finishedAt: draft.startedAt, durationSeconds: null };
}

// ---------------------------------------------------------------------------
// Cell readers
// ---------------------------------------------------------------------------

function readUnit(value: string, fallback: WeightUnit): WeightUnit {
  const text = value.trim().toLowerCase();
  if (text === 'kg' || text === 'kgs' || text.startsWith('kilo')) return 'kg';
  if (text === 'lb' || text === 'lbs' || text.startsWith('pound')) return 'lb';
  return fallback;
}

function readDistanceUnit(value: string, fallback: DistanceUnit): DistanceUnit {
  const text = value.trim().toLowerCase();
  if (text === 'km' || text.startsWith('kilom')) return 'km';
  if (text === 'mi' || text.startsWith('mile')) return 'mi';
  return fallback;
}

/** RPE if the file records it, otherwise the RIR read as the RPE it means. */
function readEffort(rpe: string, rir: string): number | null {
  const direct = parseRpe(rpe);
  if (direct !== null) return direct;

  const reserve = parseNumber(rir);
  return reserve === null ? null : rirToRpe(reserve);
}

/** Trims the float noise a unit conversion leaves behind: 224.99999999999997 kg. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// How far back to import
// ---------------------------------------------------------------------------

/**
 * The cutoffs the import screen offers.
 *
 * "Everything" leads because it is what someone moving apps wants, and the
 * shorter windows exist for the other case: trying the app out on last week's
 * training without committing three years of history to it.
 */
export const IMPORT_RANGES = [
  { value: 'all', label: 'Everything', days: null },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 91 },
  { value: '1y', label: 'Last year', days: 365 },
] as const;

export type ImportRange = (typeof IMPORT_RANGES)[number]['value'];

/**
 * The earliest instant a range admits, or null for everything.
 *
 * Anchored to local midnight rather than to the current time, so "last 7 days"
 * means seven calendar days including today: not "168 hours ago", which
 * silently drops the session you did last Tuesday morning.
 */
export function importCutoff(range: ImportRange, now: Date = new Date()): number | null {
  const days = IMPORT_RANGES.find((option) => option.value === range)?.days ?? null;
  if (days === null) return null;

  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  midnight.setDate(midnight.getDate() - (days - 1));
  return midnight.getTime();
}

export function filterWorkoutsSince(
  workouts: readonly ImportedWorkout[],
  cutoff: number | null,
): ImportedWorkout[] {
  if (cutoff === null) return [...workouts];
  return workouts.filter((workout) => workout.startedAt >= cutoff);
}

/** Sets across a list of workouts, for the counts on the confirmation screen. */
export function countSets(workouts: readonly ImportedWorkout[]): number {
  return workouts.reduce(
    (total, workout) =>
      total + workout.exercises.reduce((sets, exercise) => sets + exercise.sets.length, 0),
    0,
  );
}

/** Distinct exercise names, in the order they first appear. */
export function collectExerciseNames(workouts: readonly ImportedWorkout[]): string[] {
  const seen = new Map<string, string>();
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const key = exercise.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, exercise.name);
    }
  }
  return [...seen.values()];
}
