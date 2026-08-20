/**
 * Per-exercise aggregates: what you train most, and what your log can be
 * ranked on.
 */

import {
  effectiveWeightKg,
  setOneRepMaxKg,
  setVolumeKg,
  type Equipment,
  type MuscleGroup,
  type OneRepMaxFormula,
  type SetType,
  type TrackingType,
} from '@lift/shared';
import { and, count, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';

import { statWindow, type StatRange, type StatWindow } from './windows';

/** Bodyweight and 1RM formula, threaded through from settings. */
export interface LiftingContext {
  bodyweightKg?: number | null;
  formula?: OneRepMaxFormula;
}

interface SetRow {
  startedAt: Date;
  workoutId: string;
  exerciseId: string;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  setType: SetType;
  isCompleted: boolean;
}

interface ExerciseMeta {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  trackingType: TrackingType;
  thumbnailUrl: string | null;
  isCustom: boolean;
  isArchived: boolean;
}

/**
 * Completed sets in a window, with the exercise columns these screens draw.
 *
 * Same two-query shape as `muscle-stats`, and for the same reason — but a
 * different column list: nothing here needs `secondaryMuscles`, and everything
 * here needs a name and a thumbnail.
 */
async function loadSets(
  from: Date | null,
  to: Date | null,
): Promise<{ rows: SetRow[]; metaById: Map<string, ExerciseMeta> }> {
  const filters = [
    eq(workoutSets.isCompleted, true),
    isNull(workoutSets.deletedAt),
    isNull(workoutExercises.deletedAt),
    isNull(workouts.deletedAt),
    isNotNull(workouts.finishedAt),
  ];
  if (from) filters.push(gte(workouts.startedAt, from));
  if (to) filters.push(lt(workouts.startedAt, to));

  const rows = await db
    .select({
      startedAt: workouts.startedAt,
      workoutId: workouts.id,
      exerciseId: workoutExercises.exerciseId,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      setType: workoutSets.setType,
      isCompleted: workoutSets.isCompleted,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(...filters));

  const ids = [...new Set(rows.map((row) => row.exerciseId))];
  const meta = ids.length
    ? await db
        .select({
          id: exercises.id,
          name: exercises.name,
          equipment: exercises.equipment,
          primaryMuscle: exercises.primaryMuscle,
          trackingType: exercises.trackingType,
          thumbnailUrl: exercises.thumbnailUrl,
          isCustom: exercises.isCustom,
          isArchived: exercises.isArchived,
        })
        .from(exercises)
        .where(inArray(exercises.id, ids))
    : [];

  return { rows, metaById: new Map(meta.map((row) => [row.id, row])) };
}

// ---------------------------------------------------------------------------
// Main exercises
// ---------------------------------------------------------------------------

export interface MainExercise {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  thumbnailUrl: string | null;
  /** Distinct finished sessions the exercise appeared in. */
  times: number;
  sets: number;
  reps: number;
  volumeKg: number;
  bestOneRepMaxKg: number;
  heaviestKg: number;
  lastPerformedAt: number;
}

export interface MainExercises {
  range: StatRange;
  window: StatWindow;
  /** Most-performed first. */
  exercises: MainExercise[];
  /** Finished sessions in the window — the denominator for "2 of 9 sessions". */
  sessions: number;
  /** Working sets across every exercise in the window. */
  totalSets: number;
}

/**
 * The exercises you actually do, ordered by how often you do them.
 *
 * Ranked by **sessions containing the exercise**, not by set count. Set count
 * ranks a routine's accessory block above the lift it was built around — five
 * sets of curls in one session outrank three sessions of squats — and the
 * question the screen answers is which lifts a programme is made of.
 */
export async function getMainExercises(
  range: StatRange,
  ctx: LiftingContext = {},
  now: Date = new Date(),
): Promise<MainExercises> {
  const window = statWindow(range, now);
  return { range, window, ...(await getExercisesBetween(window.from, window.to, ctx)) };
}

/**
 * The same rollup over an arbitrary span, for callers that own their own
 * window — the monthly report, which is bounded by a calendar month rather
 * than by a trailing range.
 */
export async function getExercisesBetween(
  from: Date | null,
  to: Date | null,
  ctx: LiftingContext = {},
): Promise<{ exercises: MainExercise[]; sessions: number; totalSets: number }> {
  const { rows, metaById } = await loadSets(from, to);

  const byExercise = new Map<string, MainExercise>();
  const sessionsPerExercise = new Map<string, Set<string>>();
  const sessions = new Set<string>();
  let totalSets = 0;

  for (const row of rows) {
    const meta = metaById.get(row.exerciseId);
    // A warm-up is not work, and an exercise deleted out from under its own
    // history has nothing left to name it with.
    if (row.setType === 'warmup' || !meta) continue;

    const analytics = {
      trackingType: meta.trackingType,
      bodyweightKg: ctx.bodyweightKg ?? 0,
      formula: ctx.formula,
    };

    let entry = byExercise.get(meta.id);
    if (!entry) {
      entry = {
        id: meta.id,
        name: meta.name,
        equipment: meta.equipment,
        primaryMuscle: meta.primaryMuscle,
        thumbnailUrl: meta.thumbnailUrl,
        times: 0,
        sets: 0,
        reps: 0,
        volumeKg: 0,
        bestOneRepMaxKg: 0,
        heaviestKg: 0,
        lastPerformedAt: 0,
      };
      byExercise.set(meta.id, entry);
      sessionsPerExercise.set(meta.id, new Set());
    }

    entry.sets += 1;
    entry.reps += row.reps ?? 0;
    entry.volumeKg += setVolumeKg(row, analytics);
    entry.bestOneRepMaxKg = Math.max(entry.bestOneRepMaxKg, setOneRepMaxKg(row, analytics));
    entry.heaviestKg = Math.max(entry.heaviestKg, effectiveWeightKg(row, analytics));
    entry.lastPerformedAt = Math.max(entry.lastPerformedAt, row.startedAt.getTime());
    sessionsPerExercise.get(meta.id)!.add(row.workoutId);

    sessions.add(row.workoutId);
    totalSets += 1;
  }

  for (const [id, seen] of sessionsPerExercise) {
    byExercise.get(id)!.times = seen.size;
  }

  return {
    exercises: [...byExercise.values()].sort(
      (a, b) => b.times - a.times || b.sets - a.sets || a.name.localeCompare(b.name),
    ),
    sessions: sessions.size,
    totalSets,
  };
}

// ---------------------------------------------------------------------------
// Leaderboard eligibility
// ---------------------------------------------------------------------------

/**
 * Sessions of a lift before its best counts as a result rather than an attempt.
 *
 * One good day is a data point; three separate sessions is a lift you train.
 * The threshold exists so a single mis-typed weight — 500 instead of 50 —
 * cannot crown itself the top of the board.
 */
export const LEADERBOARD_MIN_SESSIONS = 3;

/**
 * Equipment whose load means the same thing in every gym.
 *
 * A 100 kg barbell is 100 kg wherever it is racked. A machine's stack is not:
 * plate weights, lever arms and pulley ratios differ by manufacturer, so "80"
 * on one leg press is nowhere near "80" on another. Cables have the same
 * problem through the pulley. Comparing those numbers between people — or
 * between two gyms you have trained at — measures the equipment, not the lift,
 * so they are left off the board rather than quietly ranked.
 */
export const LEADERBOARD_EQUIPMENT: readonly Equipment[] = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'smith_machine',
  'bodyweight',
];

/**
 * Tracking types that produce a comparable load.
 *
 * `weight_reps` and `weighted_bodyweight` both resolve to kilograms moved for
 * reps. Assisted variants are excluded: the number logged is how much help you
 * took, so a *lower* figure is the stronger lift and no single ordering is
 * right for a mixed list. Duration and distance exercises are not lifts.
 */
export const LEADERBOARD_TRACKING: readonly TrackingType[] = [
  'weight_reps',
  'weighted_bodyweight',
];

export interface LeaderboardExercise {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  thumbnailUrl: string | null;
  /** Sessions containing a scoring set. Compared against `LEADERBOARD_MIN_SESSIONS`. */
  sessions: number;
  bestOneRepMaxKg: number;
  /** The set behind the best estimate, so the screen can show its working. */
  bestSetWeightKg: number;
  bestSetReps: number;
  achievedAt: number;
  heaviestKg: number;
  /** Best estimate as a multiple of bodyweight. Null when no bodyweight is on record. */
  bodyweightMultiple: number | null;
}

export interface LeaderboardBoard {
  /** Lifts with enough history to stand as a result. Strongest estimate first. */
  qualified: LeaderboardExercise[];
  /** Eligible lifts you have trained, but not yet often enough. */
  pending: LeaderboardExercise[];
  /** How many exercises in the library are eligible at all. */
  eligibleInLibrary: number;
  /** True when the multiples are meaningful — i.e. a bodyweight is on record. */
  hasBodyweight: boolean;
}

/** Whether an exercise is the *kind* of lift a board can rank. */
export function isLeaderboardEligible(exercise: {
  equipment: Equipment;
  trackingType: TrackingType;
  isCustom: boolean;
  isArchived: boolean;
}): boolean {
  return (
    !exercise.isCustom &&
    !exercise.isArchived &&
    LEADERBOARD_EQUIPMENT.includes(exercise.equipment) &&
    LEADERBOARD_TRACKING.includes(exercise.trackingType)
  );
}

/**
 * Your board: every eligible lift, scored by best estimated one-rep max.
 *
 * Scored on an estimate rather than a tested single because almost nobody tests
 * singles, and a table that only counted them would be empty. The set behind
 * each estimate is carried alongside it so the figure can be shown with its
 * working — "142 kg, from 120 × 5" is a claim a reader can check, where a bare
 * 142 is one they have to take on trust.
 *
 * Ranking is against your own history. Nothing here is sent anywhere, and there
 * is no population to place you in — a global board would need every other
 * user's log, which this app has no business collecting for a statistics
 * screen.
 */
export async function getLeaderboardExercises(
  ctx: LiftingContext = {},
): Promise<LeaderboardBoard> {
  const [{ rows, metaById }, [libraryCount]] = await Promise.all([
    loadSets(null, null),
    db
      .select({ total: count() })
      .from(exercises)
      .where(
        and(
          isNull(exercises.deletedAt),
          eq(exercises.isCustom, false),
          eq(exercises.isArchived, false),
          inArray(exercises.equipment, [...LEADERBOARD_EQUIPMENT]),
          inArray(exercises.trackingType, [...LEADERBOARD_TRACKING]),
        ),
      ),
  ]);

  const bodyweightKg = ctx.bodyweightKg ?? null;
  const byExercise = new Map<string, LeaderboardExercise>();
  const sessionsPerExercise = new Map<string, Set<string>>();

  for (const row of rows) {
    const meta = metaById.get(row.exerciseId);
    if (row.setType === 'warmup' || !meta || !isLeaderboardEligible(meta)) continue;

    const analytics = {
      trackingType: meta.trackingType,
      bodyweightKg: bodyweightKg ?? 0,
      formula: ctx.formula,
    };

    const oneRepMax = setOneRepMaxKg(row, analytics);
    // A set with no load or no reps scores nothing and proves nothing, so it
    // does not count toward the session threshold either.
    if (oneRepMax <= 0) continue;

    let entry = byExercise.get(meta.id);
    if (!entry) {
      entry = {
        id: meta.id,
        name: meta.name,
        equipment: meta.equipment,
        primaryMuscle: meta.primaryMuscle,
        thumbnailUrl: meta.thumbnailUrl,
        sessions: 0,
        bestOneRepMaxKg: 0,
        bestSetWeightKg: 0,
        bestSetReps: 0,
        achievedAt: 0,
        heaviestKg: 0,
        bodyweightMultiple: null,
      };
      byExercise.set(meta.id, entry);
      sessionsPerExercise.set(meta.id, new Set());
    }

    if (oneRepMax > entry.bestOneRepMaxKg) {
      entry.bestOneRepMaxKg = oneRepMax;
      entry.bestSetWeightKg = effectiveWeightKg(row, analytics);
      entry.bestSetReps = row.reps ?? 0;
      entry.achievedAt = row.startedAt.getTime();
    }

    entry.heaviestKg = Math.max(entry.heaviestKg, effectiveWeightKg(row, analytics));
    sessionsPerExercise.get(meta.id)!.add(row.workoutId);
  }

  for (const [id, seen] of sessionsPerExercise) {
    const entry = byExercise.get(id)!;
    entry.sessions = seen.size;
    entry.bodyweightMultiple =
      bodyweightKg && bodyweightKg > 0 ? entry.bestOneRepMaxKg / bodyweightKg : null;
  }

  const all = [...byExercise.values()];
  const byStrength = (a: LeaderboardExercise, b: LeaderboardExercise) =>
    b.bestOneRepMaxKg - a.bestOneRepMaxKg || a.name.localeCompare(b.name);

  return {
    qualified: all.filter((e) => e.sessions >= LEADERBOARD_MIN_SESSIONS).sort(byStrength),
    // Closest to qualifying first: this half of the screen is a to-do list.
    pending: all
      .filter((e) => e.sessions < LEADERBOARD_MIN_SESSIONS)
      .sort((a, b) => b.sessions - a.sessions || byStrength(a, b)),
    eligibleInLibrary: libraryCount?.total ?? 0,
    hasBodyweight: bodyweightKg !== null && bodyweightKg > 0,
  };
}
