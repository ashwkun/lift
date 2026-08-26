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
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts, type Workout } from '@/db/schema';

import {
  advance,
  bucketLabel,
  bucketStart,
  granularityForMonths,
  monthsBetween,
  MS_PER_DAY,
  MS_PER_WEEK,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type Granularity,
} from './windows';

export type { Granularity };

export interface DashboardStats {
  totalWorkouts: number;
  weekStreak: number;
  activeDays: number;
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

  return {
    totalWorkouts: completed.length,
    weekStreak: computeWeekStreak(dates),
    activeDays: countActiveDays(dates),
    lastWorkoutAt: dates[0] ?? null,
    lifetimeVolumeKg: completed.reduce((sum, row) => sum + row.totalVolumeKg, 0),
  };
}

/**
 * One week's totals, in the three metrics a session records.
 *
 * The names match `TrendBucket`'s deliberately, so `METRIC` in `metrics.ts`
 * reads either one without knowing which it was handed: Home plots weeks and
 * History plots its own buckets, and there is one definition of what "duration"
 * means to a chart.
 */
export interface WeeklyPoint {
  /** Epoch ms of that week's Monday. */
  weekStart: number;
  volumeKg: number;
  durationSeconds: number;
  reps: number;
  workouts: number;
  /**
   * The same three totals, but only counting the days up to and including
   * today's day-of-week, whichever week this bucket is.
   *
   * Exists for one comparison: Home's "vs last week" delta, read on a week
   * that is still running. Held on every bucket rather than computed only for
   * the previous one, since the cost is the same `+=` the full totals already
   * pay and a caller reading a bucket in isolation would otherwise have no way
   * to ask for it.
   */
  volumeKgToDate: number;
  durationSecondsToDate: number;
  repsToDate: number;
}

/**
 * Per-week totals over the trailing `weeks` window.
 *
 * Empty weeks are included with zero rather than skipped: a gap in training
 * should read as a dip in the chart, not get quietly compressed away.
 *
 * All three metrics are summed in the one pass whichever the caller is showing.
 * They are columns on `workouts` rather than joins, so the second and third
 * cost a `+=` each, and Home switches between them without going back to the
 * database.
 */
export async function getWeeklyTotals(weeks = 12, now: Date = new Date()): Promise<WeeklyPoint[]> {
  const currentWeekStart = startOfWeek(now);
  const windowStart = new Date(currentWeekStart);
  windowStart.setDate(windowStart.getDate() - (weeks - 1) * 7);

  // How many days of *any* week count towards its "to date" totals: today is
  // Monday means one (Monday itself), so this is never zero and a Monday
  // reading isn't comparing against nothing.
  const elapsedDays = Math.round((startOfDay(now).getTime() - currentWeekStart.getTime()) / MS_PER_DAY) + 1;

  const rows = await db
    .select({
      startedAt: workouts.startedAt,
      totalVolumeKg: workouts.totalVolumeKg,
      durationSeconds: workouts.durationSeconds,
      totalReps: workouts.totalReps,
    })
    .from(workouts)
    .where(
      and(
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        gte(workouts.startedAt, windowStart),
      ),
    );

  const buckets = new Map<number, WeeklyPoint>();
  for (let i = 0; i < weeks; i++) {
    const start = new Date(windowStart);
    start.setDate(start.getDate() + i * 7);
    buckets.set(start.getTime(), {
      weekStart: start.getTime(),
      volumeKg: 0,
      durationSeconds: 0,
      reps: 0,
      workouts: 0,
      volumeKgToDate: 0,
      durationSecondsToDate: 0,
      repsToDate: 0,
    });
  }

  for (const row of rows) {
    const weekStart = startOfWeek(row.startedAt);
    const bucket = buckets.get(weekStart.getTime());
    if (!bucket) continue;

    bucket.volumeKg += row.totalVolumeKg;
    // Nullable on the table: a session that was never finished properly has no
    // duration, and it counts as a workout with none rather than as a gap.
    bucket.durationSeconds += row.durationSeconds ?? 0;
    bucket.reps += row.totalReps;
    bucket.workouts += 1;

    const dayIndex = Math.round(
      (startOfDay(row.startedAt).getTime() - weekStart.getTime()) / MS_PER_DAY,
    );
    if (dayIndex < elapsedDays) {
      bucket.volumeKgToDate += row.totalVolumeKg;
      bucket.durationSecondsToDate += row.durationSeconds ?? 0;
      bucket.repsToDate += row.totalReps;
    }
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

// ---------------------------------------------------------------------------
// History search
// ---------------------------------------------------------------------------

/**
 * What the history list is narrowed to.
 *
 * Both parts empty means "no filter", which is a different fact from "nothing
 * matched" and has to stay distinguishable: the first restores the dashboard,
 * the second draws an empty state. `isHistoryFilterActive` is the one place
 * that decides which of the two the screen is in.
 */
export interface HistoryFilter {
  /** Free text, matched against exercise names and the session's own name and notes. */
  text: string;
  /** Primary muscles, of which the session must have trained at least one. */
  muscles: readonly MuscleGroup[];
}

/**
 * One session, in exactly the columns a history row draws.
 *
 * Structurally what `WorkoutCard` renders, but declared from the table rather
 * than imported from the component: a repository that types its results off a
 * view is a repository that cannot be read without the view.
 */
export type HistoryMatch = Pick<
  Workout,
  | 'id'
  | 'name'
  | 'startedAt'
  | 'durationSeconds'
  | 'totalVolumeKg'
  | 'totalSets'
  | 'prCount'
>;

/** Column selection producing `HistoryMatch`. */
const historyMatchColumns = {
  id: workouts.id,
  name: workouts.name,
  startedAt: workouts.startedAt,
  durationSeconds: workouts.durationSeconds,
  totalVolumeKg: workouts.totalVolumeKg,
  totalSets: workouts.totalSets,
  prCount: workouts.prCount,
} as const;

/**
 * How many words of a query are honoured.
 *
 * Every token adds three more `LIKE` terms (session name, session notes,
 * exercise name), so a stray paste into the field would otherwise compile a
 * statement with hundreds of them and run it against every session in the log.
 * Dropping the tail only ever *widens* the result, since the tokens are ANDed,
 * so the failure mode of the cap is a few extra rows rather than a missing one.
 * Nobody narrows a training log past four words.
 */
const MAX_SEARCH_TOKENS = 4;

function searchTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
}

/** True when the filter asks for anything at all. Whitespace is not a query. */
export function isHistoryFilterActive(filter: HistoryFilter): boolean {
  return filter.text.trim().length > 0 || filter.muscles.length > 0;
}

/**
 * `column` contains every token, in any order.
 *
 * One `%token%` per word and ANDed, rather than one `%whole query%`, so
 * "barbell bench" finds "Bench Press (Barbell)". People type the words they
 * remember, not the order the catalog names them in. It is the same rule
 * `createExerciseMatcher` applies to the catalog search, so a query behaves the
 * same way whichever field it is typed into.
 *
 * No `lower()` around the column: SQLite's `LIKE` already folds ASCII case, and
 * wrapping a column in a function is what rules out ever indexing it. The gap
 * is accented names, where SQLite's own `lower()` does not fold either, so the
 * wrapper would buy nothing for the cost.
 */
function containsTokens(column: AnyColumn, tokens: string[]): SQL | undefined {
  return and(
    // `%` and `_` are `LIKE` wildcards: a search for "50%" would otherwise
    // match every session ever logged. `escape` is the only way to spell them
    // literally, and it has to be attached to each term.
    ...tokens.map((token) => sql`${column} like ${`%${escapeLike(token)}%`} escape '\\'`),
  );
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, '\\$&');
}

/**
 * Sessions matching `filter`, newest first, capped at `limit`.
 *
 * Spans the whole log whatever the history screen's range control is set to.
 * The one search anybody runs here is "when did I last do this", and answering
 * it with "not in the last three months" because a segmented control two cards
 * up was left on `3m` would be a search that lies by omission.
 *
 * Runs in SQLite rather than over the rows the screen already holds. History
 * pages 25 sessions at a time, so a client-side filter would search the visible
 * page and confidently report "no matches" for the bench session from March:
 * broken on exactly the size of log that makes anyone want a search box.
 *
 * The exercise and muscle tests are correlated `exists` subqueries rather than
 * a join up to `exercises` with a `distinct`. A join fans one session out to a
 * row per matching exercise, so `limit 25` stops meaning 25 sessions, and the
 * `distinct` needed to put that right forces every matching row in the log to
 * be materialised and sorted before the limit can apply. `exists` keeps the
 * outer row count equal to the session count, stops at the first matching
 * exercise per session, and reaches it through `workout_exercises_workout_idx`.
 *
 * Deleted rows are excluded at both levels: a session keeps its exercises when
 * one is removed from it, and matching on a removed exercise would return a
 * session whose detail screen does not mention it.
 */
export async function searchWorkouts(
  filter: HistoryFilter,
  limit: number,
): Promise<HistoryMatch[]> {
  const tokens = searchTokens(filter.text);

  // No filter is not the same question as one nothing matches, and this
  // function only answers the second. Callers gate on `isHistoryFilterActive`.
  if (tokens.length === 0 && filter.muscles.length === 0) return [];

  const conditions: (SQL | undefined)[] = [
    isNotNull(workouts.finishedAt),
    isNull(workouts.deletedAt),
  ];

  if (tokens.length > 0) {
    conditions.push(
      or(
        containsTokens(workouts.name, tokens),
        containsTokens(workouts.notes, tokens),
        exists(
          db
            .select({ matched: sql`1` })
            .from(workoutExercises)
            .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
            .where(
              and(
                eq(workoutExercises.workoutId, workouts.id),
                isNull(workoutExercises.deletedAt),
                containsTokens(exercises.name, tokens),
              ),
            ),
        ),
      ),
    );
  }

  if (filter.muscles.length > 0) {
    conditions.push(
      exists(
        db
          .select({ matched: sql`1` })
          .from(workoutExercises)
          .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
          .where(
            and(
              eq(workoutExercises.workoutId, workouts.id),
              isNull(workoutExercises.deletedAt),
              // Primary muscle only. The breakdown above the list counts an
              // assisting muscle at `SECONDARY_SET_WEIGHT` because it is
              // measuring volume, but a filter is a yes or a no: "chest"
              // returning every pressing session that happens to involve
              // triceps is a filter that has not filtered.
              inArray(exercises.primaryMuscle, [...filter.muscles]),
            ),
          ),
      ),
    );
  }

  return db
    .select(historyMatchColumns)
    .from(workouts)
    .where(and(...conditions))
    .orderBy(desc(workouts.startedAt))
    .limit(limit);
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
