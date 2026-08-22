/**
 * Working out what each column of a workout export means.
 *
 * Every app spells the same twelve ideas differently: `weight_kg`,
 * `Weight (lbs)`, `weightKg`, `Load`, so rather than a parser per app there is
 * one alias table and a header is matched against it. That is the approach
 * LiftShift takes (github.com/aree6/LiftShift), and it is why an export from an
 * app nobody has heard of still imports: the columns are recognised, not the
 * vendor.
 *
 * Header spellings collapse before matching, so a single alias covers three
 * conventions at once: `weight kg` matches `weight_kg`, `weightKg` and
 * `Weight (kg)` without any of them being written down.
 */

import type { DistanceUnit, WeightUnit } from '../types.ts';

/** The fields an import can make use of. Anything else in the file is ignored. */
export type ImportField =
  | 'workoutTitle'
  | 'workoutNotes'
  | 'startTime'
  | 'endTime'
  | 'workoutDuration'
  | 'exercise'
  | 'exerciseNotes'
  | 'supersetId'
  | 'setIndex'
  | 'setType'
  | 'weight'
  | 'weightUnit'
  | 'reps'
  | 'distance'
  | 'distanceUnit'
  | 'setDuration'
  | 'rpe'
  | 'rir';

/**
 * Aliases, already in collapsed form (lower case, single spaces, no
 * punctuation). Order within a field is irrelevant; length decides matches.
 *
 * Two pairs are deliberately kept apart because both members appear in the same
 * file and mean different things:
 *
 * - `setDuration` vs `workoutDuration`. Hevy's `duration_seconds` and Lift's
 *   own `Duration (s)` are per *set*; a bare "duration" therefore belongs to
 *   the set. A session length has to say so in its name.
 * - `exerciseNotes` vs `workoutNotes`. Hevy carries both: `exercise_notes`
 *   and `description`: on every row. An unqualified "notes" goes to the
 *   exercise, which is where per-row text belongs.
 */
const ALIASES: Record<ImportField, string[]> = {
  workoutTitle: [
    'title',
    'workout',
    'workout name',
    'workout title',
    'session',
    'session name',
    'routine',
    'routine name',
    'name',
  ],
  workoutNotes: [
    'description',
    'workout notes',
    'workout note',
    'workout description',
    'session notes',
    'session note',
  ],
  startTime: [
    'start time',
    'start',
    'start date',
    'started at',
    'date',
    'datetime',
    'timestamp',
    'workout date',
    'workout perform date',
    'performed at',
    'performed',
    'logged at',
    'created at',
  ],
  endTime: ['end time', 'end', 'end date', 'ended at', 'finished at', 'completed at'],
  workoutDuration: [
    'workout duration',
    'session duration',
    'workout length',
    'total time',
    'elapsed',
    'elapsed time',
  ],
  exercise: [
    'exercise',
    'exercise title',
    'exercise name',
    // Lyfta's own API spells it this way; their export inherits the typo.
    'excercise name',
    'movement',
    'lift',
  ],
  exerciseNotes: ['exercise notes', 'exercise note', 'set notes', 'set note', 'notes', 'note', 'comment', 'comments'],
  supersetId: ['superset id', 'superset', 'superset group', 'circuit id', 'group id'],
  setIndex: ['set index', 'set number', 'set order', 'set no', 'set num', 'set'],
  setType: ['set type', 'set kind', 'type'],
  weight: [
    'weight kg',
    'weight kgs',
    'weight lb',
    'weight lbs',
    'weight pounds',
    'weight',
    'load',
    'kg',
    'lbs',
  ],
  weightUnit: ['weight unit', 'unit'],
  reps: ['reps', 'rep', 'repetitions', 'rep count', 'repetition'],
  distance: [
    'distance km',
    'distance mi',
    'distance miles',
    'distance m',
    'distance meters',
    'distance',
    'dist',
  ],
  distanceUnit: ['distance unit'],
  setDuration: [
    'duration seconds',
    'duration s',
    'duration sec',
    'duration secs',
    'set duration',
    'duration',
  ],
  rpe: ['rpe', 'perceived exertion', 'rate of perceived exertion'],
  rir: ['rir', 'reps in reserve', 'reps left'],
};

/** Where each field was found, or -1 for "this file doesn't have one". */
export type ColumnMap = Record<ImportField, number>;

export interface ResolvedColumns {
  index: ColumnMap;
  /**
   * The unit the weight column names in its own header, if it names one.
   *
   * `weight_kg` is a promise about the values underneath it and outranks
   * anything the user picked in the UI. A Hevy export is kilograms even when
   * the app displays pounds.
   */
  weightUnit: WeightUnit | null;
  distanceUnit: DistanceUnit | null;
  /** Headers that matched nothing, for the "columns ignored" line. */
  unmatched: string[];
}

/**
 * Assigns columns to fields, one each.
 *
 * Greedy over the best matches: every plausible (column, field) pairing is
 * scored, sorted, and taken in order while both sides are still free. That
 * settles the collisions that a per-field scan gets wrong: a file with both
 * `Set` and `Set Type` gives `Set Type` to `setType` on the exact match, which
 * leaves `Set` to `setIndex` rather than both fields fighting over one column.
 */
export function resolveColumns(header: readonly string[]): ResolvedColumns {
  const collapsed = header.map(collapseHeader);

  interface Candidate {
    column: number;
    field: ImportField;
    score: number;
  }

  const candidates: Candidate[] = [];

  collapsed.forEach((name, column) => {
    if (!name) return;

    for (const [field, aliases] of Object.entries(ALIASES) as [ImportField, string[]][]) {
      let best = 0;
      for (const alias of aliases) {
        // An exact header beats a header that merely contains the alias, so
        // `weight` never outranks `weight kg` on a `Weight (kg)` column.
        if (name === alias) best = Math.max(best, alias.length * 10);
        else if (containsWord(name, alias)) best = Math.max(best, alias.length);
      }
      if (best > 0) candidates.push({ column, field, score: best });
    }
  });

  // Sorted by score, then by column so equal scores resolve left to right,
  // which is stable across runs and matches the order a person reads the file.
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const index = emptyColumnMap();
  const takenColumns = new Set<number>();

  for (const candidate of candidates) {
    if (index[candidate.field] !== -1) continue;
    if (takenColumns.has(candidate.column)) continue;
    index[candidate.field] = candidate.column;
    takenColumns.add(candidate.column);
  }

  const weightHeader = index.weight === -1 ? '' : collapsed[index.weight]!;
  const distanceHeader = index.distance === -1 ? '' : collapsed[index.distance]!;

  return {
    index,
    weightUnit: unitFromHeader(weightHeader),
    distanceUnit: distanceFromHeader(distanceHeader),
    unmatched: header.filter((_, column) => !takenColumns.has(column) && collapsed[column] !== ''),
  };
}

export function emptyColumnMap(): ColumnMap {
  return {
    workoutTitle: -1,
    workoutNotes: -1,
    startTime: -1,
    endTime: -1,
    workoutDuration: -1,
    exercise: -1,
    exerciseNotes: -1,
    supersetId: -1,
    setIndex: -1,
    setType: -1,
    weight: -1,
    weightUnit: -1,
    reps: -1,
    distance: -1,
    distanceUnit: -1,
    setDuration: -1,
    rpe: -1,
    rir: -1,
  };
}

/**
 * `Weight (kg)`, `weight_kg` and `weightKg` all collapse to `weight kg`.
 *
 * The camel-case split runs first: doing it after the lower-casing would have
 * nothing left to split on.
 */
export function collapseHeader(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whole-word containment, so `set` matches `set index` but not `offset`. */
function containsWord(haystack: string, needle: string): boolean {
  const at = haystack.indexOf(needle);
  if (at === -1) return false;

  const before = at === 0 || haystack[at - 1] === ' ';
  const afterAt = at + needle.length;
  const after = afterAt === haystack.length || haystack[afterAt] === ' ';

  return before && after;
}

function unitFromHeader(header: string): WeightUnit | null {
  if (/\b(kg|kgs|kilos|kilograms?)\b/.test(header)) return 'kg';
  if (/\b(lb|lbs|pounds?)\b/.test(header)) return 'lb';
  return null;
}

function distanceFromHeader(header: string): DistanceUnit | null {
  if (/\b(km|kilometers?|kilometres?)\b/.test(header)) return 'km';
  if (/\b(mi|miles?)\b/.test(header)) return 'mi';
  return null;
}

// ---------------------------------------------------------------------------
// Which app wrote this
// ---------------------------------------------------------------------------

export const IMPORT_SOURCES = ['hevy', 'lyfta', 'lift', 'strong', 'unknown'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  hevy: 'Hevy',
  lyfta: 'Lyfta',
  lift: 'Lift',
  strong: 'Strong',
  unknown: 'a workout app',
};

/**
 * Names the app a file came from, for the confirmation screen only.
 *
 * Nothing downstream branches on the answer. The column map does all the real
 * work, so a wrong guess costs a sentence, and an unrecognised file still
 * imports. That is the point of guessing here rather than asking the user to
 * declare the format and then failing them when they pick wrong.
 */
export function detectSource(header: readonly string[]): ImportSource {
  const names = new Set(header.map(collapseHeader));
  const has = (...required: string[]) => required.every((name) => names.has(name));

  if (has('title', 'start time', 'exercise title', 'set index')) return 'hevy';
  if (has('date', 'workout', 'exercise', 'set type', 'weight kg')) return 'lift';
  if (names.has('excercise name') || names.has('workout perform date')) return 'lyfta';
  // Strong's own header, semicolon-delimited in most locales.
  if (has('date', 'workout name', 'exercise name')) return 'strong';

  return 'unknown';
}
