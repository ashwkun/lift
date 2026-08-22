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
  type MuscleGroup,
  type SetLike,
} from '@lift/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';

import {
  advance,
  bucketLabel,
  bucketStart,
  granularityForMonths,
  monthsBetween,
  MS_PER_WEEK,
  startOfMonth,
  startOfWeek,
  type Granularity,
} from './windows';

export type { Granularity };

export interface DashboardStats {
  totalWorkouts: number;
  weekStreak: number;
  activeDays: number;
  thisWeekWorkouts: number;
  thisWeekVolumeKg: number;
  lastWorkoutAt: Date | null;
  /**
   * Every kilogram ever moved. Included here rather than left to the one screen
   * that shows it, because the query below already reads the volume of every
   * completed workout. Profile was running the identical full-table scan a
   * second time to sum the same column.
   */
  lifetimeVolumeKg: number;
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
    lifetimeVolumeKg: completed.reduce((sum, row) => sum + row.totalVolumeKg, 0),
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
 * Empty weeks are included with zero rather than skipped: a gap in training
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

// ---------------------------------------------------------------------------
// History trends
// ---------------------------------------------------------------------------

export const HISTORY_RANGES = [
  { value: '3m', label: '3 months' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number]['value'];

/** The metrics the history chart can plot. All are stored per workout. */
export const HISTORY_METRICS = [
  { value: 'volume', label: 'Volume' },
  { value: 'duration', label: 'Duration' },
  { value: 'reps', label: 'Reps' },
] as const;

export type HistoryMetric = (typeof HISTORY_METRICS)[number]['value'];

export interface TrendBucket {
  /** Epoch ms of the bucket's first day. Doubles as its identity. */
  start: number;
  label: string;
  volumeKg: number;
  durationSeconds: number;
  reps: number;
  sets: number;
  workouts: number;
}

export interface MuscleBreakdownEntry {
  muscle: MuscleGroup;
  bodyPart: BodyPart;
  /**
   * Working sets, with sets that only trained this muscle indirectly counted at
   * `SECONDARY_SET_WEIGHT`. Fractional as a result.
   */
  sets: number;
  /** Sets where this muscle was the primary target. Whole number. */
  directSets: number;
  reps: number;
  volumeKg: number;
  /** Distinct exercises that trained this muscle in the window. */
  exercises: number;
  /**
   * `sets` averaged over the weeks the window spans. The body map reads this
   * rather than `sets`, so the same muscle looks the same whether you are
   * viewing three months or a year.
   */
  setsPerWeek: number;
}

export interface HistoryAnalytics {
  range: HistoryRange;
  granularity: Granularity;
  buckets: TrendBucket[];
  totals: {
    workouts: number;
    volumeKg: number;
    durationSeconds: number;
    reps: number;
    sets: number;
  };
  /** Per muscle, busiest first. Drives the body map and its detail list. */
  muscles: MuscleBreakdownEntry[];
  bodyParts: MuscleDistributionEntry[];
  /** Highest set count of any single muscle: the heatmap's upper bound. */
  peakMuscleSets: number;
  /** Weeks the window actually spans, floored at 1. Divisor for `setsPerWeek`. */
  weeks: number;
}

/**
 * Everything the history screen's analytics header needs, in one pass.
 *
 * Trends read from the denormalised totals on `workouts` (no set-level join),
 * while the muscle breakdown needs the full join down to `exercises`. Keeping
 * them in one function means the screen makes a single call per range change
 * instead of three that can land out of order.
 */
export async function getHistoryAnalytics(range: HistoryRange): Promise<HistoryAnalytics> {
  const now = new Date();

  let since: Date | null = null;
  if (range === '3m') {
    since = startOfWeek(now);
    since.setDate(since.getDate() - 12 * 7); // 13 weekly buckets, current week last
  } else if (range === '1y') {
    since = startOfMonth(now);
    since.setMonth(since.getMonth() - 11); // 12 monthly buckets
  }

  const rangeFilter = [isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)];
  if (since) rangeFilter.push(gte(workouts.startedAt, since));

  const sessions = await db
    .select({
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      totalVolumeKg: workouts.totalVolumeKg,
      totalReps: workouts.totalReps,
      totalSets: workouts.totalSets,
    })
    .from(workouts)
    .where(and(...rangeFilter))
    .orderBy(asc(workouts.startedAt));

  const totals = {
    workouts: sessions.length,
    volumeKg: sessions.reduce((sum, row) => sum + row.totalVolumeKg, 0),
    durationSeconds: sessions.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0),
    reps: sessions.reduce((sum, row) => sum + row.totalReps, 0),
    sets: sessions.reduce((sum, row) => sum + row.totalSets, 0),
  };

  // "All time" spans whatever the user has; the other ranges are fixed windows
  // and keep their granularity even when the user has only just started, so the
  // axis doesn't reshape itself after every workout.
  let granularity: Granularity;
  if (range === '3m') {
    granularity = 'week';
  } else if (range === '1y') {
    granularity = 'month';
  } else {
    const first = sessions[0]?.startedAt ?? now;
    granularity = granularityForMonths(monthsBetween(first, now));
  }

  const firstStart = since ?? (sessions[0]?.startedAt ?? now);
  const cursorStart = bucketStart(firstStart, granularity);
  const lastStart = bucketStart(now, granularity);

  const buckets = new Map<number, TrendBucket>();
  for (
    let cursor = cursorStart;
    cursor.getTime() <= lastStart.getTime();
    cursor = advance(cursor, granularity)
  ) {
    buckets.set(cursor.getTime(), {
      start: cursor.getTime(),
      label: bucketLabel(cursor, granularity),
      volumeKg: 0,
      durationSeconds: 0,
      reps: 0,
      sets: 0,
      workouts: 0,
    });
  }

  for (const row of sessions) {
    const bucket = buckets.get(bucketStart(row.startedAt, granularity).getTime());
    // A workout older than the first bucket can only happen on a fixed window,
    // where the query already excluded it, but a clock change could produce one.
    if (!bucket) continue;

    bucket.volumeKg += row.totalVolumeKg;
    bucket.durationSeconds += row.durationSeconds ?? 0;
    bucket.reps += row.totalReps;
    bucket.sets += row.totalSets;
    bucket.workouts += 1;
  }

  const { muscles, bodyParts, peakMuscleSets, weeks } = await getMuscleBreakdown(since);

  return {
    range,
    granularity,
    buckets: [...buckets.values()],
    totals,
    muscles,
    bodyParts,
    peakMuscleSets,
    weeks,
  };
}

/**
 * How much a set counts toward a muscle the exercise only trains indirectly.
 *
 * A close-grip press is real triceps work, but not the set that a dedicated
 * pushdown is, and counting it whole would put arms level with chest on a pure
 * push routine. Half is the conventional discount.
 */
export const SECONDARY_SET_WEIGHT = 0.5;

/**
 * Working sets per muscle since `since` (null = all time).
 *
 * Counts sets rather than volume for the same reason `getMuscleDistribution`
 * does: volume lets a heavy squat bury an entire session of arm work.
 *
 * Only `sets` carries the secondary-muscle weighting. `reps`, `volumeKg` and
 * the body-part split stay primary-only, so the numbers printed next to each
 * muscle still add up to the totals shown everywhere else in the app.
 */
async function getMuscleBreakdown(since: Date | null): Promise<{
  muscles: MuscleBreakdownEntry[];
  bodyParts: MuscleDistributionEntry[];
  peakMuscleSets: number;
  weeks: number;
}> {
  const filters = [
    eq(workoutSets.isCompleted, true),
    isNull(workoutSets.deletedAt),
    isNull(workoutExercises.deletedAt),
    isNull(workouts.deletedAt),
    isNotNull(workouts.finishedAt),
  ];
  if (since) filters.push(gte(workouts.startedAt, since));

  // Just the columns `setVolumeKg` and the tallies below read. Selecting the
  // whole `workoutSets` row decoded every timestamp, id and sync column of tens
  // of thousands of rows to reach six fields.
  const rows = await db
    .select({
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      setType: workoutSets.setType,
      isCompleted: workoutSets.isCompleted,
      exerciseId: workoutExercises.exerciseId,
      startedAt: workouts.startedAt,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(...filters));

  // The exercise columns come from a second, small query keyed by the ids the
  // sets actually reference. `secondaryMuscles` is a JSON column, so joining it
  // in above meant drizzle parsing the same handful of arrays once per set:
  // roughly fifteen thousand parses to learn about a hundred exercises.
  const exerciseIds = [...new Set(rows.map((row) => row.exerciseId))];
  const catalogue = exerciseIds.length
    ? await db
        .select({
          id: exercises.id,
          primaryMuscle: exercises.primaryMuscle,
          secondaryMuscles: exercises.secondaryMuscles,
          trackingType: exercises.trackingType,
        })
        .from(exercises)
        .where(inArray(exercises.id, exerciseIds))
    : [];

  const exerciseById = new Map(catalogue.map((row) => [row.id, row]));

  const byMuscle = new Map<MuscleGroup, MuscleBreakdownEntry>();
  // Tracked separately from the entry so `exercises` counts distinct ids rather
  // than sets.
  const seenExercises = new Map<MuscleGroup, Set<string>>();
  const byBodyPart = new Map<BodyPart, MuscleDistributionEntry>();
  let earliest = Number.POSITIVE_INFINITY;

  const touch = (muscle: MuscleGroup): MuscleBreakdownEntry => {
    let entry = byMuscle.get(muscle);
    if (!entry) {
      entry = {
        muscle,
        bodyPart: MUSCLE_TO_BODY_PART[muscle],
        sets: 0,
        directSets: 0,
        reps: 0,
        volumeKg: 0,
        exercises: 0,
        setsPerWeek: 0,
      };
      byMuscle.set(muscle, entry);
      seenExercises.set(muscle, new Set());
    }
    return entry;
  };

  for (const row of rows) {
    if (row.setType === 'warmup') continue;

    // An exercise deleted out from under its history: the join used to drop
    // these rows, and the lookup drops them the same way.
    const exercise = exerciseById.get(row.exerciseId);
    if (!exercise) continue;

    const muscle = exercise.primaryMuscle;
    const bodyPart = MUSCLE_TO_BODY_PART[muscle];
    const volume = setVolumeKg(row, { trackingType: exercise.trackingType });
    earliest = Math.min(earliest, row.startedAt.getTime());

    const entry = touch(muscle);
    entry.sets += 1;
    entry.directSets += 1;
    entry.reps += row.reps ?? 0;
    entry.volumeKg += volume;
    seenExercises.get(muscle)!.add(row.exerciseId);

    // Seeded exercises always carry an array, but a row written by an older
    // build (or by a sync peer) may not.
    const secondary = Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [];
    for (const other of secondary) {
      if (other === muscle) continue;
      const assisted = touch(other);
      assisted.sets += SECONDARY_SET_WEIGHT;
      seenExercises.get(other)!.add(row.exerciseId);
    }

    let part = byBodyPart.get(bodyPart);
    if (!part) {
      part = { bodyPart, sets: 0, volumeKg: 0 };
      byBodyPart.set(bodyPart, part);
    }
    part.sets += 1;
    part.volumeKg += volume;
  }

  for (const [muscle, ids] of seenExercises) {
    byMuscle.get(muscle)!.exercises = ids.size;
  }

  // On "all time" the window is however long the log actually is, not however
  // long ago the first workout could have been.
  const from = since?.getTime() ?? (Number.isFinite(earliest) ? earliest : Date.now());
  const weeks = Math.max(1, (Date.now() - from) / MS_PER_WEEK);

  const muscles = [...byMuscle.values()].sort((a, b) => b.sets - a.sets);
  for (const entry of muscles) entry.setsPerWeek = entry.sets / weeks;

  return {
    muscles,
    bodyParts: [...byBodyPart.values()].sort((a, b) => b.sets - a.sets),
    peakMuscleSets: muscles[0]?.sets ?? 0,
    weeks,
  };
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
