/**
 * The share file's shape, and reading one back.
 *
 * Pure: no database, no filesystem. Split from `index.ts` for the reason
 * `@lift/shared/import` is split from `features/import`. Deciding whether a
 * file is a valid share is the part with the edge cases, and a module that
 * imports SQLite and `expo-file-system` to answer that question cannot be run
 * anywhere except a phone.
 */

import type { ImportedWorkout } from '@lift/shared/import';

export const SHARE_FORMAT = 'lift-share';

/** Bumped whenever the shape changes incompatibly, so imports can refuse. */
export const SHARE_FORMAT_VERSION = 1;

/** One prescribed set of a shared routine: targets, never performed values. */
export interface PrescribedSet {
  setType: string;
  targetReps: number | null;
  targetWeightKg: number | null;
  targetDurationSeconds: number | null;
  targetDistanceKm: number | null;
  targetRpe: number | null;
}

/** One exercise of a shared routine, as prescribed rather than as performed. */
export interface SharedRoutineExercise {
  /** As the sender's library spells it. Matched on the receiving device. */
  name: string;
  notes: string | null;
  restSeconds: number | null;
  /** Exercises sharing a number are performed as a superset. */
  supersetGroup: number | null;
  sets: PrescribedSet[];
}

export interface SharedRoutine {
  name: string;
  notes: string | null;
  exercises: SharedRoutineExercise[];
}

/**
 * A shared routine and a shared session in one envelope.
 *
 * One `kind` field rather than two file formats, because the receiver picks a
 * file before anyone has told them which of the two it is. Sniffing one tag is
 * what lets the import screen say "this is a routine called Push Day A" instead
 * of asking the user to have known.
 */
export type SharedFile =
  | {
      format: typeof SHARE_FORMAT;
      version: number;
      exportedAt: string;
      kind: 'routine';
      routine: SharedRoutine;
    }
  | {
      format: typeof SHARE_FORMAT;
      version: number;
      exportedAt: string;
      kind: 'session';
      /**
       * The same shape every CSV importer produces, so a shared session reaches
       * `importWorkouts` without a second staging path.
       */
      session: ImportedWorkout;
    };

export function envelope() {
  return {
    format: SHARE_FORMAT,
    version: SHARE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
  } as const;
}

/** A routine name as a filename. See `writeShareFile`. */
export function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return cleaned || 'workout';
}

/**
 * Reads a share file, or says why it isn't one.
 *
 * Every rejection names what was wanted, for the same reason `inspectBackup`
 * does: the person holding the file usually cannot tell a backup from a share
 * from an unrelated `.json`, and "expected a Lift share" is the only message
 * that tells them which of the three they picked.
 */
export function inspectShare(json: string): SharedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not readable JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('That file does not contain a Lift share.');
  }

  const file = parsed as Partial<SharedFile>;

  if (file.format !== SHARE_FORMAT) {
    throw new Error('That file is not a Lift share.');
  }

  if (typeof file.version !== 'number' || file.version > SHARE_FORMAT_VERSION) {
    throw new Error(
      `This was shared by a newer version of Lift (format ${String(file.version)}). Update the app first.`,
    );
  }

  if (file.kind === 'routine') {
    const routine = file.routine;
    if (!routine || typeof routine.name !== 'string' || !Array.isArray(routine.exercises)) {
      throw new Error('That share says it holds a routine but the routine is missing.');
    }
    return file as SharedFile;
  }

  if (file.kind === 'session') {
    const session = file.session;
    if (!session || typeof session.name !== 'string' || !Array.isArray(session.exercises)) {
      throw new Error('That share says it holds a workout but the workout is missing.');
    }
    return file as SharedFile;
  }

  throw new Error('That share holds something this version does not understand.');
}

/**
 * A shared routine as the resolver wants to see it.
 *
 * `planExercises` takes sessions because that is what every other caller has.
 * A routine is the same question (these names, which library rows?) wearing a
 * different shape, so it is wrapped rather than given a second resolver: one
 * matching path means a routine and a session that name the same exercise can
 * never land on two different rows.
 *
 * The targets become the sets the resolver types a new exercise from, which is
 * what it needs them for: an exercise prescribed in kilograms and reps infers
 * `weight`, one prescribed in seconds infers a duration lift.
 */
export function routineAsImportedWorkout(routine: SharedRoutine): ImportedWorkout {
  return {
    name: routine.name,
    notes: routine.notes,
    startedAt: 0,
    finishedAt: 0,
    durationSeconds: null,
    exercises: routine.exercises.map((exercise) => ({
      name: exercise.name,
      notes: exercise.notes,
      supersetGroup: exercise.supersetGroup,
      sets: exercise.sets.map((set) => ({
        setType: set.setType as never,
        weightKg: set.targetWeightKg,
        reps: set.targetReps,
        durationSeconds: set.targetDurationSeconds,
        distanceKm: set.targetDistanceKm,
        rpe: set.targetRpe,
      })),
    })),
  };
}
