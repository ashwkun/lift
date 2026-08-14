/**
 * Aggregate queries backing the dashboard and progress screens.
 */

import {
  computeWeekStreak,
  countActiveDays,
  MUSCLE_TO_BODY_PART,
  setOneRepMaxKg,
  setVolumeKg,
  type AnalyticsContext,
  type BodyPart,
  type SetLike,
} from '@ironlog/shared';
import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';

export interface DashboardStats {
  totalWorkouts: number;
  weekStreak: number;
  activeDays: number;
  thisWeekWorkouts: number;
  thisWeekVolumeKg: number;
  lastWorkoutAt: Date | null;
}

/** Monday 00:00 of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfWeek = (result.getDay() + 6) % 7; // Monday === 0
  result.setDate(result.getDate() - dayOfWeek);
  return result;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const completed = await db
    .select({
      id: workouts.id,
      startedAt: workouts.startedAt,
      totalVolumeKg: workouts.totalVolumeKg,
    })
    .from(workouts)
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(desc(workouts.startedAt));

  const dates = completed.map((row) => row.startedAt);
  const weekStart = startOfWeek(new Date()).getTime();
  const thisWeek = completed.filter((row) => row.startedAt.getTime() >= weekStart);

  return {
    totalWorkouts: completed.length,
    weekStreak: computeWeekStreak(dates),
    activeDays: countActiveDays(dates),
    thisWeekWorkouts: thisWeek.length,
    thisWeekVolumeKg: thisWeek.reduce((sum, row) => sum + row.totalVolumeKg, 0),
    lastWorkoutAt: dates[0] ?? null,
  };
}

export interface WeeklyVolumePoint {
  /** Epoch ms of that week's Monday. */
  weekStart: number;
  volumeKg: number;
  workouts: number;
}

/**
 * Volume per week over the trailing `weeks` window.
 *
 * Empty weeks are included with zero rather than skipped — a gap in training
 * should read as a dip in the chart, not get quietly compressed away.
 */
export async function getWeeklyVolume(weeks = 12): Promise<WeeklyVolumePoint[]> {
  const currentWeekStart = startOfWeek(new Date());
  const windowStart = new Date(currentWeekStart);
  windowStart.setDate(windowStart.getDate() - (weeks - 1) * 7);

  const rows = await db
    .select({ startedAt: workouts.startedAt, totalVolumeKg: workouts.totalVolumeKg })
    .from(workouts)
    .where(
      and(
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        gte(workouts.startedAt, windowStart),
      ),
    );

  const buckets = new Map<number, WeeklyVolumePoint>();
  for (let i = 0; i < weeks; i++) {
    const start = new Date(windowStart);
    start.setDate(start.getDate() + i * 7);
    buckets.set(start.getTime(), { weekStart: start.getTime(), volumeKg: 0, workouts: 0 });
  }

  for (const row of rows) {
    const key = startOfWeek(row.startedAt).getTime();
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.volumeKg += row.totalVolumeKg;
    bucket.workouts += 1;
  }

  return [...buckets.values()].sort((a, b) => a.weekStart - b.weekStart);
}

export interface MuscleDistributionEntry {
  bodyPart: BodyPart;
  sets: number;
  volumeKg: number;
}

/**
 * Working sets per body part over the trailing `days` window.
 *
 * Counts **sets**, not volume, as the primary measure: set count is the standard
 * unit for judging weekly training distribution, and volume would let heavy
 * compounds drown out everything else.
 */
export async function getMuscleDistribution(days = 30): Promise<MuscleDistributionEntry[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({
      set: workoutSets,
      primaryMuscle: exercises.primaryMuscle,
      trackingType: exercises.trackingType,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutSets.isCompleted, true),
        isNull(workoutSets.deletedAt),
        isNull(workoutExercises.deletedAt),
        isNull(workouts.deletedAt),
        isNotNull(workouts.finishedAt),
        gte(workouts.startedAt, since),
      ),
    );

  const totals = new Map<BodyPart, MuscleDistributionEntry>();

  for (const row of rows) {
    if (row.set.setType === 'warmup') continue;

    const bodyPart = MUSCLE_TO_BODY_PART[row.primaryMuscle];
    let entry = totals.get(bodyPart);
    if (!entry) {
      entry = { bodyPart, sets: 0, volumeKg: 0 };
      totals.set(bodyPart, entry);
    }

    entry.sets += 1;
    entry.volumeKg += setVolumeKg(row.set as SetLike, { trackingType: row.trackingType });
  }

  return [...totals.values()].sort((a, b) => b.sets - a.sets);
}

export interface ExerciseProgressPoint {
  performedAt: number;
  estimatedOneRepMaxKg: number;
  heaviestKg: number;
  volumeKg: number;
  totalReps: number;
}

/** Per-session progression for one exercise, oldest first. */
export async function getExerciseProgress(
  exerciseId: string,
  ctx: Omit<AnalyticsContext, 'trackingType'> = {},
): Promise<ExerciseProgressPoint[]> {
  const [exercise] = await db
    .select({ trackingType: exercises.trackingType })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);

  if (!exercise) return [];

  const rows = await db
    .select({ set: workoutSets, startedAt: workouts.startedAt, workoutId: workouts.id })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        eq(workoutSets.isCompleted, true),
        isNull(workoutSets.deletedAt),
        isNull(workoutExercises.deletedAt),
        isNull(workouts.deletedAt),
        isNotNull(workouts.finishedAt),
      ),
    )
    .orderBy(workouts.startedAt);

  const analytics: AnalyticsContext = { ...ctx, trackingType: exercise.trackingType };
  const byWorkout = new Map<string, ExerciseProgressPoint>();

  for (const row of rows) {
    if (row.set.setType === 'warmup') continue;

    let point = byWorkout.get(row.workoutId);
    if (!point) {
      point = {
        performedAt: row.startedAt.getTime(),
        estimatedOneRepMaxKg: 0,
        heaviestKg: 0,
        volumeKg: 0,
        totalReps: 0,
      };
      byWorkout.set(row.workoutId, point);
    }

    point.estimatedOneRepMaxKg = Math.max(
      point.estimatedOneRepMaxKg,
      setOneRepMaxKg(row.set as SetLike, analytics),
    );
    point.heaviestKg = Math.max(point.heaviestKg, row.set.weightKg ?? 0);
    point.volumeKg += setVolumeKg(row.set as SetLike, analytics);
    point.totalReps += row.set.reps ?? 0;
  }

  return [...byWorkout.values()].sort((a, b) => a.performedAt - b.performedAt);
}

/** Calendar dates with a completed workout, for the activity heatmap. */
export async function getWorkoutDates(days = 365): Promise<Date[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({ startedAt: workouts.startedAt })
    .from(workouts)
    .where(
      and(
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        gte(workouts.startedAt, since),
      ),
    );

  return rows.map((row) => row.startedAt);
}
