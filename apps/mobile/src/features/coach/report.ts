/**
 * Reading a window of the log into the shape a review is written from.
 *
 * Everything here is a read. The document itself is assembled by
 * `buildCoachPrompt` in `@lift/shared`, which is pure and tested; this half is
 * the queries, and it exists to answer one awkward requirement. The summary
 * has to describe the *whole* window even when the session log printed inside
 * it is capped. So the sets are read once and used twice: the tallies see every
 * row, the log sees the most recent sessions those rows belong to.
 */

import {
  dayKey,
  MEASUREMENT_KINDS,
  type CoachExercise,
  type CoachMeasurement,
  type CoachMuscle,
  type CoachRecord,
  type CoachReport,
  type CoachRoutine,
  type CoachSession,
  type CoachSet,
  type MeasurementKind,
  type MuscleGroup,
  type SetType,
  type TrackingType,
} from '@lift/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  bodyMeasurements,
  exercises,
  personalRecords,
  routineExercises,
  routineSets,
  routines,
  workoutExercises,
  workoutSets,
  workouts,
} from '@/db/schema';
import { SECONDARY_SET_WEIGHT } from '@/features/analytics/repository';
import { statWindow, windowWeeks, type StatRange } from '@/features/analytics/windows';
import { useSettings } from '@/store/settings';

/**
 * How many sessions the log is allowed to print.
 *
 * A year of four-day weeks is over two hundred sessions and roughly a quarter
 * of a million characters: past what most chat windows accept in one message,
 * and well past the point where a model reads the middle of it carefully. Forty
 * is about three months of serious training, which is the span a review of
 * *recent* work is actually about; the totals and the volume table keep
 * covering the whole window either way, and the document says so where it
 * truncates.
 */
export const MAX_LOGGED_SESSIONS = 40;

export interface CoachReportOptions {
  range: StatRange;
  /** The session-by-session log. Off, the document says it was withheld. */
  includeSessions: boolean;
  includeRoutines: boolean;
  /** The user's own note: goal, injury, constraints. Trimmed by the caller. */
  note: string | null;
  now?: Date;
}

/** Reads everything a review needs. Pure reads. Nothing here writes. */
export async function buildCoachReport(options: CoachReportOptions): Promise<CoachReport> {
  const now = options.now ?? new Date();
  const window = statWindow(options.range, now);

  const settings = useSettings.getState();

  const [sessionRows, setRows, routineList, measurementRows] = await Promise.all([
    loadSessions(window.from, window.to),
    loadSets(window.from, window.to),
    options.includeRoutines ? loadRoutines() : Promise.resolve([]),
    loadMeasurements(),
  ]);

  const exerciseById = await loadExerciseFacts(setRows.map((row) => row.exerciseId));

  const earliest = sessionRows[0]?.startedAt.getTime() ?? null;
  const weeks = windowWeeks(window, earliest);

  const muscles = tallyMuscles(setRows, exerciseById, weeks);
  const sessions = options.includeSessions
    ? assembleSessions(sessionRows, setRows, exerciseById)
    : [];

  // The cap keeps the *end* of the window: a review is about where the training
  // has got to, and dropping the recent sessions to keep the old ones would
  // answer a question nobody asked.
  const logged = sessions.slice(-MAX_LOGGED_SESSIONS);

  const trainedExerciseIds = [...new Set(setRows.map((row) => row.exerciseId))];

  return {
    generatedAt: now.getTime(),
    from: window.from?.getTime() ?? null,
    to: window.to.getTime(),
    rangeLabel: window.label,
    weeks,
    profile: {
      weightUnit: settings.weightUnit,
      distanceUnit: settings.distanceUnit,
      measurementUnit: settings.measurementUnit,
      bodyweightKg: settings.bodyweightKg,
      heightCm: settings.heightCm,
      sex: settings.sex,
      note: options.note && options.note.trim().length > 0 ? options.note.trim() : null,
    },
    totals: {
      workouts: sessionRows.length,
      activeDays: new Set(sessionRows.map((row) => dayKey(row.startedAt))).size,
      // The denormalised totals on the workout row, which is what every other
      // screen in the app reports. Recounting the set rows here would produce a
      // second, slightly different answer for the same window.
      sets: sessionRows.reduce((sum, row) => sum + row.totalSets, 0),
      reps: sessionRows.reduce((sum, row) => sum + row.totalReps, 0),
      volumeKg: sessionRows.reduce((sum, row) => sum + row.totalVolumeKg, 0),
      durationSeconds: sessionRows.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0),
      prs: sessionRows.reduce((sum, row) => sum + row.prCount, 0),
    },
    muscles,
    sessions: logged,
    routines: routineList,
    records: await loadRecords(trainedExerciseIds),
    measurements: latestPerKind(measurementRows),
    bodyweightSeries: bodyweightIn(measurementRows, window.from, window.to),
    omittedSessions: sessions.length - logged.length,
    sessionsIncluded: options.includeSessions,
    routinesIncluded: options.includeRoutines,
  };
}

// ---------------------------------------------------------------------------
// Sessions and their sets
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  name: string;
  notes: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  prCount: number;
}

async function loadSessions(from: Date | null, to: Date): Promise<SessionRow[]> {
  const filters = [isNotNull(workouts.finishedAt), isNull(workouts.deletedAt), lt(workouts.startedAt, to)];
  if (from) filters.push(gte(workouts.startedAt, from));

  return db
    .select({
      id: workouts.id,
      name: workouts.name,
      notes: workouts.notes,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      totalVolumeKg: workouts.totalVolumeKg,
      totalSets: workouts.totalSets,
      totalReps: workouts.totalReps,
      prCount: workouts.prCount,
    })
    .from(workouts)
    .where(and(...filters))
    .orderBy(asc(workouts.startedAt));
}

interface SetRow {
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string;
  exercisePosition: number;
  exerciseNotes: string | null;
  supersetGroup: number | null;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  rpe: number | null;
  isCompleted: boolean;
}

/**
 * Every completed set in the window, in the order it was performed.
 *
 * Completed only. An unticked set is work that was planned and not done, and it
 * is not in the log the app shows either: putting it in front of a reviewer
 * invites a critique of a failed set that never happened.
 */
async function loadSets(from: Date | null, to: Date): Promise<SetRow[]> {
  const filters = [
    eq(workoutSets.isCompleted, true),
    isNull(workoutSets.deletedAt),
    isNull(workoutExercises.deletedAt),
    isNull(workouts.deletedAt),
    isNotNull(workouts.finishedAt),
    lt(workouts.startedAt, to),
  ];
  if (from) filters.push(gte(workouts.startedAt, from));

  return db
    .select({
      workoutId: workoutExercises.workoutId,
      workoutExerciseId: workoutExercises.id,
      exerciseId: workoutExercises.exerciseId,
      exercisePosition: workoutExercises.position,
      exerciseNotes: workoutExercises.notes,
      supersetGroup: workoutExercises.supersetGroup,
      setType: workoutSets.setType,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      rpe: workoutSets.rpe,
      isCompleted: workoutSets.isCompleted,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(...filters))
    .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(workoutSets.position));
}

interface ExerciseFacts {
  name: string;
  equipment: CoachExercise['equipment'];
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
}

/**
 * The exercise columns the sets reference, as a second small query.
 *
 * Not a join, for the reason `muscle-stats.ts` spells out: `secondaryMuscles`
 * is a JSON column, and joining it makes drizzle parse the same few arrays once
 * per set rather than once per exercise.
 */
async function loadExerciseFacts(ids: string[]): Promise<Map<string, ExerciseFacts>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      equipment: exercises.equipment,
      primaryMuscle: exercises.primaryMuscle,
      secondaryMuscles: exercises.secondaryMuscles,
      trackingType: exercises.trackingType,
    })
    .from(exercises)
    .where(inArray(exercises.id, unique));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        name: row.name,
        equipment: row.equipment,
        primaryMuscle: row.primaryMuscle,
        // Seeded rows always carry an array; one written by an older build or
        // arriving over sync may not.
        secondaryMuscles: Array.isArray(row.secondaryMuscles) ? row.secondaryMuscles : [],
        trackingType: row.trackingType,
      },
    ]),
  );
}

/** Groups the flat set rows back into sessions, exercises and sets. */
function assembleSessions(
  sessionRows: SessionRow[],
  setRows: SetRow[],
  exerciseById: Map<string, ExerciseFacts>,
): CoachSession[] {
  const blocksByWorkout = new Map<string, Map<string, CoachExercise>>();

  for (const row of setRows) {
    const facts = exerciseById.get(row.exerciseId);
    // An exercise deleted out from under its own history. The app's own screens
    // drop these rows; a review that printed "unknown exercise, 4 sets" would
    // only invite a question nobody can answer.
    if (!facts) continue;

    let blocks = blocksByWorkout.get(row.workoutId);
    if (!blocks) {
      blocks = new Map();
      blocksByWorkout.set(row.workoutId, blocks);
    }

    let block = blocks.get(row.workoutExerciseId);
    if (!block) {
      block = {
        name: facts.name,
        equipment: facts.equipment,
        primaryMuscle: facts.primaryMuscle,
        secondaryMuscles: facts.secondaryMuscles,
        trackingType: facts.trackingType,
        notes: row.exerciseNotes,
        supersetGroup: row.supersetGroup,
        sets: [],
      };
      blocks.set(row.workoutExerciseId, block);
    }

    block.sets.push(toCoachSet(row));
  }

  return sessionRows.flatMap((session) => {
    const blocks = [...(blocksByWorkout.get(session.id)?.values() ?? [])];
    // A finished workout whose sets were all deleted, or all left unticked. It
    // has totals of zero and nothing to review, and printing an empty heading
    // for it makes the log look like it lost something.
    if (blocks.length === 0) return [];

    return [
      {
        startedAt: session.startedAt.getTime(),
        name: session.name,
        durationSeconds: session.durationSeconds,
        notes: session.notes,
        volumeKg: session.totalVolumeKg,
        sets: session.totalSets,
        reps: session.totalReps,
        prCount: session.prCount,
        exercises: blocks,
      },
    ];
  });
}

function toCoachSet(row: SetRow): CoachSet {
  return {
    setType: row.setType,
    weightKg: row.weightKg,
    reps: row.reps,
    durationSeconds: row.durationSeconds,
    distanceKm: row.distanceKm,
    rpe: row.rpe,
  };
}

// ---------------------------------------------------------------------------
// Muscles
// ---------------------------------------------------------------------------

/**
 * Working sets per muscle, on the same rules the statistics screens use.
 *
 * Warm-ups excluded, the target muscle credited a whole set and each assisting
 * muscle a half. Deliberately the same arithmetic as `muscle-stats.ts` rather
 * than a call into it: that module reads its own rows for a date span, and this
 * one already has the rows in hand for a window it has to describe exactly.
 */
function tallyMuscles(
  setRows: SetRow[],
  exerciseById: Map<string, ExerciseFacts>,
  weeks: number,
): CoachMuscle[] {
  const byMuscle = new Map<MuscleGroup, CoachMuscle>();
  const seen = new Map<MuscleGroup, Set<string>>();

  const touch = (muscle: MuscleGroup): CoachMuscle => {
    let entry = byMuscle.get(muscle);
    if (!entry) {
      entry = { muscle, sets: 0, directSets: 0, exercises: 0, setsPerWeek: 0 };
      byMuscle.set(muscle, entry);
      seen.set(muscle, new Set());
    }
    return entry;
  };

  for (const row of setRows) {
    if (row.setType === 'warmup') continue;

    const facts = exerciseById.get(row.exerciseId);
    if (!facts) continue;

    const entry = touch(facts.primaryMuscle);
    entry.sets += 1;
    entry.directSets += 1;
    seen.get(facts.primaryMuscle)!.add(row.exerciseId);

    for (const other of facts.secondaryMuscles) {
      if (other === facts.primaryMuscle) continue;
      touch(other).sets += SECONDARY_SET_WEIGHT;
      seen.get(other)!.add(row.exerciseId);
    }
  }

  for (const [muscle, ids] of seen) byMuscle.get(muscle)!.exercises = ids.size;

  const tallies = [...byMuscle.values()];
  for (const entry of tallies) entry.setsPerWeek = entry.sets / weeks;

  // Busiest first, so the muscles a reviewer has most to say about are the ones
  // it reads first, and the neglected ones are the short tail at the bottom,
  // which is itself the finding.
  return tallies.sort((a, b) => b.sets - a.sets);
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

/**
 * Every routine on the device, whether or not it was performed in the window.
 *
 * The window bounds the *history*, not the plan: a routine the user has not got
 * to in six weeks is exactly the one a reviewer should be told about, and
 * filtering it out would hide the gap between what they intend to train and
 * what they have been training.
 */
async function loadRoutines(): Promise<CoachRoutine[]> {
  const routineRows = await db
    .select({
      id: routines.id,
      name: routines.name,
      notes: routines.notes,
      lastPerformedAt: routines.lastPerformedAt,
    })
    .from(routines)
    .where(isNull(routines.deletedAt))
    .orderBy(asc(routines.position));

  if (routineRows.length === 0) return [];

  const links = await db
    .select({
      id: routineExercises.id,
      routineId: routineExercises.routineId,
      exerciseId: routineExercises.exerciseId,
      notes: routineExercises.notes,
      restSeconds: routineExercises.restSeconds,
      supersetGroup: routineExercises.supersetGroup,
      name: exercises.name,
      equipment: exercises.equipment,
      primaryMuscle: exercises.primaryMuscle,
    })
    .from(routineExercises)
    .innerJoin(exercises, eq(routineExercises.exerciseId, exercises.id))
    .where(
      and(
        inArray(routineExercises.routineId, routineRows.map((row) => row.id)),
        isNull(routineExercises.deletedAt),
      ),
    )
    .orderBy(asc(routineExercises.position));

  const targetRows = links.length
    ? await db
        .select({
          routineExerciseId: routineSets.routineExerciseId,
          setType: routineSets.setType,
          targetReps: routineSets.targetReps,
          targetWeightKg: routineSets.targetWeightKg,
          targetRpe: routineSets.targetRpe,
          targetDurationSeconds: routineSets.targetDurationSeconds,
          targetDistanceKm: routineSets.targetDistanceKm,
        })
        .from(routineSets)
        .where(
          and(
            inArray(routineSets.routineExerciseId, links.map((link) => link.id)),
            isNull(routineSets.deletedAt),
          ),
        )
        .orderBy(asc(routineSets.position))
    : [];

  const targetsByLink = new Map<string, CoachRoutine['exercises'][number]['sets']>();
  for (const row of targetRows) {
    const bucket = targetsByLink.get(row.routineExerciseId) ?? [];
    bucket.push({
      setType: row.setType,
      reps: row.targetReps,
      weightKg: row.targetWeightKg,
      rpe: row.targetRpe,
      durationSeconds: row.targetDurationSeconds,
      distanceKm: row.targetDistanceKm,
    });
    targetsByLink.set(row.routineExerciseId, bucket);
  }

  const linksByRoutine = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByRoutine.get(link.routineId) ?? [];
    bucket.push(link);
    linksByRoutine.set(link.routineId, bucket);
  }

  return routineRows.map((routine) => ({
    name: routine.name,
    notes: routine.notes,
    lastPerformedAt: routine.lastPerformedAt?.getTime() ?? null,
    exercises: (linksByRoutine.get(routine.id) ?? []).map((link) => ({
      name: link.name,
      equipment: link.equipment,
      primaryMuscle: link.primaryMuscle,
      notes: link.notes,
      restSeconds: link.restSeconds,
      supersetGroup: link.supersetGroup,
      sets: targetsByLink.get(link.id) ?? [],
    })),
  }));
}

// ---------------------------------------------------------------------------
// Records and measurements
// ---------------------------------------------------------------------------

/**
 * Current bests for the exercises trained in the window.
 *
 * All-time rather than window-bounded. A best set two years ago is still the
 * number the current sets are moving toward, but narrowed to the exercises the
 * window actually contains, because a review of the last month has nothing to
 * say about a lift that was not in it.
 *
 * "Best" is the highest value per exercise and kind, which is the same rule the
 * records screen applies: the table keeps historical rows, so the newest entry
 * is not necessarily the largest.
 */
async function loadRecords(exerciseIds: string[]): Promise<CoachRecord[]> {
  if (exerciseIds.length === 0) return [];

  const rows = await db
    .select({
      exerciseId: personalRecords.exerciseId,
      exercise: exercises.name,
      kind: personalRecords.kind,
      value: personalRecords.value,
      reps: personalRecords.reps,
      achievedAt: personalRecords.achievedAt,
    })
    .from(personalRecords)
    .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
    .where(and(inArray(personalRecords.exerciseId, exerciseIds), isNull(personalRecords.deletedAt)))
    .orderBy(desc(personalRecords.value));

  const best = new Map<string, CoachRecord>();

  for (const row of rows) {
    const key = `${row.exerciseId}:${row.kind}`;
    if (best.has(key)) continue;
    best.set(key, {
      exercise: row.exercise,
      kind: row.kind,
      value: row.value,
      reps: row.reps,
      achievedAt: row.achievedAt.getTime(),
    });
  }

  return [...best.values()].sort(
    (a, b) => a.exercise.localeCompare(b.exercise) || a.kind.localeCompare(b.kind),
  );
}

interface MeasurementRow {
  kind: MeasurementKind;
  value: number;
  measuredAt: Date;
}

async function loadMeasurements(): Promise<MeasurementRow[]> {
  return db
    .select({
      kind: bodyMeasurements.kind,
      value: bodyMeasurements.value,
      measuredAt: bodyMeasurements.measuredAt,
    })
    .from(bodyMeasurements)
    .where(isNull(bodyMeasurements.deletedAt))
    .orderBy(desc(bodyMeasurements.measuredAt));
}

/**
 * The newest entry of each kind. The rows arrive newest first.
 *
 * Ordered by the declared kind order rather than by date, so the table reads
 * top-down as a body does (composition, torso, arms, legs) instead of
 * reshuffling itself every time one limb is measured.
 */
function latestPerKind(rows: MeasurementRow[]): CoachMeasurement[] {
  const latest = new Map<MeasurementKind, CoachMeasurement>();

  for (const row of rows) {
    if (latest.has(row.kind)) continue;
    latest.set(row.kind, { kind: row.kind, value: row.value, measuredAt: row.measuredAt.getTime() });
  }

  return [...latest.values()].sort(
    (a, b) => MEASUREMENT_KINDS.indexOf(a.kind) - MEASUREMENT_KINDS.indexOf(b.kind),
  );
}

/** Bodyweight inside the window, oldest first: the trend line's input. */
function bodyweightIn(rows: MeasurementRow[], from: Date | null, to: Date): CoachMeasurement[] {
  return rows
    .filter(
      (row) =>
        row.kind === 'bodyweight' &&
        row.measuredAt < to &&
        (from === null || row.measuredAt >= from),
    )
    .map((row) => ({ kind: row.kind, value: row.value, measuredAt: row.measuredAt.getTime() }))
    .sort((a, b) => a.measuredAt - b.measuredAt);
}
