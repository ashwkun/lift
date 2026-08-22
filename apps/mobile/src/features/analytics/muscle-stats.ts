/**
 * Muscle-level aggregates behind the statistics screens.
 *
 * Everything here counts **sets**, not volume, as the primary measure. Set
 * count is the standard unit for judging training distribution, and volume lets
 * one heavy squat bury an entire session of arm work. A 140 kg × 5 set is
 * 700 kg, and no amount of lateral raises will ever reach it.
 */

import {
  dayKey,
  MUSCLE_TO_BODY_PART,
  setVolumeKg,
  type BodyPart,
  type MuscleGroup,
  type SetType,
  type TrackingType,
} from '@lift/shared';
import { and, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';

import { SECONDARY_SET_WEIGHT } from './repository';
import {
  bucketsFor,
  bucketStart,
  eachDay,
  granularityForMonths,
  monthsBetween,
  MS_PER_WEEK,
  statWindow,
  windowWeeks,
  type Granularity,
  type StatRange,
  type StatWindow,
  type WeekStart,
} from './windows';

// ---------------------------------------------------------------------------
// The shared read
// ---------------------------------------------------------------------------

interface WorkingSetRow {
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

interface ExerciseFacts {
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
}

/**
 * Completed sets in a window, plus the exercise facts they need.
 *
 * Two queries rather than one join, for the reason spelled out in
 * `getMuscleBreakdown`: `secondaryMuscles` is a JSON column, and joining it in
 * makes drizzle parse the same handful of arrays once per *set*: tens of
 * thousands of parses to learn about a hundred exercises. The second query is
 * keyed by the ids the sets actually reference.
 *
 * Only the six columns the tallies read are selected. Taking the whole
 * `workoutSets` row decodes every timestamp, id and sync column on the way to
 * a rep count.
 */
async function loadWorkingSets(
  from: Date | null,
  to: Date | null,
): Promise<{ rows: WorkingSetRow[]; exerciseById: Map<string, ExerciseFacts> }> {
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

  const exerciseById = new Map<string, ExerciseFacts>(
    catalogue.map((row) => [
      row.id,
      {
        primaryMuscle: row.primaryMuscle,
        // Seeded exercises always carry an array, but a row written by an older
        // build (or by a sync peer) may not.
        secondaryMuscles: Array.isArray(row.secondaryMuscles) ? row.secondaryMuscles : [],
        trackingType: row.trackingType,
      },
    ]),
  );

  return { rows, exerciseById };
}

// ---------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------

export interface MuscleTally {
  muscle: MuscleGroup;
  bodyPart: BodyPart;
  /**
   * Working sets, with sets that only trained this muscle indirectly counted at
   * `SECONDARY_SET_WEIGHT`. Fractional as a result, and the figure the body map
   * is coloured from.
   */
  sets: number;
  /** Sets where this muscle was the target. Whole, and the figure tables print. */
  directSets: number;
  reps: number;
  volumeKg: number;
  /** Distinct exercises that trained this muscle in the window. */
  exercises: number;
}

/**
 * A muscle tally under construction, alongside the exercise ids seen for it.
 *
 * The id set is kept beside the entry rather than on it so `exercises` can end
 * up a count of distinct exercises rather than of sets.
 */
type TallyBuilder = Map<MuscleGroup, { entry: MuscleTally; seen: Set<string> }>;

function touch(builder: TallyBuilder, muscle: MuscleGroup): MuscleTally {
  let slot = builder.get(muscle);
  if (!slot) {
    slot = {
      entry: {
        muscle,
        bodyPart: MUSCLE_TO_BODY_PART[muscle],
        sets: 0,
        directSets: 0,
        reps: 0,
        volumeKg: 0,
        exercises: 0,
      },
      seen: new Set(),
    };
    builder.set(muscle, slot);
  }
  return slot.entry;
}

function finish(builder: TallyBuilder): MuscleTally[] {
  for (const slot of builder.values()) slot.entry.exercises = slot.seen.size;
  return [...builder.values()].map((slot) => slot.entry).sort((a, b) => b.sets - a.sets);
}

/**
 * Folds one set into a builder, crediting the target muscle whole and every
 * assisting muscle at the secondary discount.
 *
 * Returns false when the row contributed nothing: a warm-up, or an exercise
 * deleted out from under its own history.
 */
function tallySet(
  builder: TallyBuilder,
  row: WorkingSetRow,
  facts: ExerciseFacts | undefined,
): boolean {
  if (row.setType === 'warmup' || !facts) return false;

  const muscle = facts.primaryMuscle;
  const entry = touch(builder, muscle);
  entry.sets += 1;
  entry.directSets += 1;
  entry.reps += row.reps ?? 0;
  entry.volumeKg += setVolumeKg(row, { trackingType: facts.trackingType });
  builder.get(muscle)!.seen.add(row.exerciseId);

  for (const other of facts.secondaryMuscles) {
    if (other === muscle) continue;
    touch(builder, other).sets += SECONDARY_SET_WEIGHT;
    builder.get(other)!.seen.add(row.exerciseId);
  }

  return true;
}

/** Weekly-set map in the shape `BodyMap` reads. */
export function setsPerWeekOf(muscles: MuscleTally[], weeks: number): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const entry of muscles) out[entry.muscle] = entry.sets / weeks;
  return out;
}

// ---------------------------------------------------------------------------
// A window of days: the body graph and the body-distribution table
// ---------------------------------------------------------------------------

export interface DayActivity {
  date: Date;
  /** Local-midnight day key, so a 9pm session belongs to the day the user had. */
  key: string;
  workouts: number;
  /** Working sets logged that day. */
  sets: number;
  volumeKg: number;
}

export interface MuscleBoard {
  from: number;
  /** Exclusive. */
  to: number;
  days: DayActivity[];
  muscles: MuscleTally[];
  /** Working sets across every muscle. The table's Total row. */
  totalSets: number;
  totalVolumeKg: number;
  workouts: number;
  /** Muscle → weekly set rate, the body map's input. */
  setsPerWeek: Partial<Record<MuscleGroup, number>>;
}

/**
 * Everything the body graph and its table need for one span of days.
 *
 * Serves both the rolling seven days on the statistics hub and a navigable
 * calendar week on the body-distribution screen: they differ only in which
 * dates they ask for.
 */
export async function getMuscleBoard(from: Date, to: Date): Promise<MuscleBoard> {
  const { rows, exerciseById } = await loadWorkingSets(from, to);

  const byDay = new Map<string, DayActivity>();
  for (const date of eachDay(from, to)) {
    byDay.set(dayKey(date), { date, key: dayKey(date), workouts: 0, sets: 0, volumeKg: 0 });
  }

  const builder: TallyBuilder = new Map();
  const workoutsSeen = new Set<string>();
  // Per day, because a workout has to count once for the day it happened on
  // rather than once per set.
  const workoutsPerDay = new Map<string, Set<string>>();
  let totalSets = 0;
  let totalVolumeKg = 0;

  for (const row of rows) {
    const facts = exerciseById.get(row.exerciseId);
    if (!tallySet(builder, row, facts)) continue;

    totalSets += 1;
    const volume = setVolumeKg(row, { trackingType: facts!.trackingType });
    totalVolumeKg += volume;
    workoutsSeen.add(row.workoutId);

    const key = dayKey(row.startedAt);
    const day = byDay.get(key);
    if (!day) continue; // a clock change could put a row outside its own window

    day.sets += 1;
    day.volumeKg += volume;
    const seen = workoutsPerDay.get(key) ?? new Set<string>();
    seen.add(row.workoutId);
    workoutsPerDay.set(key, seen);
  }

  for (const [key, seen] of workoutsPerDay) {
    const day = byDay.get(key);
    if (day) day.workouts = seen.size;
  }

  const muscles = finish(builder);
  // The span is measured in days rather than assumed to be a week, so the same
  // colour ramp means the same thing whether the caller asked for seven days or
  // a partial one at the edge of the log.
  const weeks = Math.max(1, (to.getTime() - from.getTime()) / MS_PER_WEEK);

  return {
    from: from.getTime(),
    to: to.getTime(),
    days: [...byDay.values()],
    muscles,
    totalSets,
    totalVolumeKg,
    workouts: workoutsSeen.size,
    setsPerWeek: setsPerWeekOf(muscles, weeks),
  };
}

// ---------------------------------------------------------------------------
// Set count per muscle group, over time
// ---------------------------------------------------------------------------

export interface MuscleSeries extends MuscleTally {
  /** Direct sets per bucket, index-aligned with `MuscleSetTrend.buckets`. */
  perBucket: number[];
  setsPerWeek: number;
}

export interface MuscleSetTrend {
  range: StatRange;
  granularity: Granularity;
  buckets: { start: number; label: string }[];
  /** Busiest muscle first. */
  muscles: MuscleSeries[];
  /** Direct working sets per bucket across every muscle. */
  totalPerBucket: number[];
  totalSets: number;
  weeks: number;
}

/**
 * Sets per muscle per period.
 *
 * The per-bucket series counts **direct** sets only. A chart of "sets logged"
 * has to be countable: a bar reading 8.5 invites the reader to work out which
 * half-set they did, and the secondary discount is a weighting for comparing
 * muscles, not a thing that happened in the gym. The ranked list beside it
 * carries both figures.
 */
export async function getMuscleSetTrend(
  range: StatRange,
  firstDayOfWeek: WeekStart = 1,
  now: Date = new Date(),
): Promise<MuscleSetTrend> {
  const window = statWindow(range, now);
  const { rows, exerciseById } = await loadWorkingSets(window.from, window.to);

  let earliest = Number.POSITIVE_INFINITY;
  for (const row of rows) earliest = Math.min(earliest, row.startedAt.getTime());
  const earliestDate = Number.isFinite(earliest) ? new Date(earliest) : null;

  const granularity = granularityFor(window, earliestDate, now);
  const buckets = bucketsFor(window, granularity, earliestDate, firstDayOfWeek);
  const indexOfBucket = new Map(buckets.map((bucket, index) => [bucket.start, index]));

  const builder: TallyBuilder = new Map();
  const perBucket = new Map<MuscleGroup, number[]>();
  const totalPerBucket = new Array<number>(buckets.length).fill(0);
  let totalSets = 0;

  for (const row of rows) {
    const facts = exerciseById.get(row.exerciseId);
    if (!tallySet(builder, row, facts)) continue;

    totalSets += 1;

    const index = indexOfBucket.get(
      bucketStart(row.startedAt, granularity, firstDayOfWeek).getTime(),
    );
    if (index === undefined) continue;

    totalPerBucket[index] = (totalPerBucket[index] ?? 0) + 1;

    const muscle = facts!.primaryMuscle;
    let series = perBucket.get(muscle);
    if (!series) {
      series = new Array<number>(buckets.length).fill(0);
      perBucket.set(muscle, series);
    }
    series[index] = (series[index] ?? 0) + 1;
  }

  const weeks = windowWeeks(window, Number.isFinite(earliest) ? earliest : null);

  return {
    range,
    granularity,
    buckets,
    muscles: finish(builder).map((entry) => ({
      ...entry,
      perBucket: perBucket.get(entry.muscle) ?? new Array<number>(buckets.length).fill(0),
      setsPerWeek: entry.sets / weeks,
    })),
    totalPerBucket,
    totalSets,
    weeks,
  };
}

/**
 * Granularity for a window.
 *
 * The fixed ranges keep theirs even when the user has only just started, so the
 * axis doesn't reshape itself after every workout. The cut sits at four months
 * because that is where weekly buckets pass ~17 bars and the axis labels start
 * colliding. "All time" is bucketed from however much history there actually is.
 */
function granularityFor(window: StatWindow, earliest: Date | null, now: Date): Granularity {
  if (window.days === null) return granularityForMonths(monthsBetween(earliest ?? now, now));
  return window.days <= 120 ? 'week' : 'month';
}

// ---------------------------------------------------------------------------
// Muscle distribution: this window against the one before it
// ---------------------------------------------------------------------------

/** The body parts the distribution chart plots, clockwise from the top. */
export const DISTRIBUTION_AXES: readonly BodyPart[] = [
  'chest',
  'core',
  'shoulders',
  'legs',
  'arms',
  'back',
];

export interface DistributionTotals {
  workouts: number;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
}

export interface DistributionAxis {
  bodyPart: BodyPart;
  current: number;
  previous: number;
}

export interface DistributionReport {
  range: StatRange;
  /** Always all six axes in `DISTRIBUTION_AXES` order, zero-filled. */
  axes: DistributionAxis[];
  totals: DistributionTotals;
  /** Null on "all time", which has no window before it to compare against. */
  previousTotals: DistributionTotals | null;
  /** Largest value on any axis in either series: the outer ring's value. */
  peak: number;
  /**
   * Working sets that fell outside the six drawn axes: cardio, full-body and
   * neck work. Reported rather than dropped, so the chart can say what it left
   * out instead of quietly disagreeing with the set count beside it.
   */
  unplottedSets: number;
}

/**
 * Set distribution across body parts, current window against previous.
 *
 * Absolute sets rather than percentage share. A share chart draws a deload week
 * and a brutal one identically (the shape is all it can express) and the
 * question this screen is asked most often is whether the last month was more
 * work than the one before it, which only an absolute scale answers. The shape
 * is still perfectly readable either way.
 */
export async function getMuscleDistributionReport(
  range: StatRange,
  now: Date = new Date(),
): Promise<DistributionReport> {
  const window = statWindow(range, now);
  const readFrom = window.previous?.from ?? window.from;

  const [{ rows, exerciseById }, sessions] = await Promise.all([
    loadWorkingSets(readFrom, window.to),
    loadSessions(readFrom, window.to),
  ]);

  const current = new Map<BodyPart, number>();
  const previous = new Map<BodyPart, number>();
  let unplottedSets = 0;

  const startOfCurrent = window.from?.getTime() ?? -Infinity;

  for (const row of rows) {
    const facts = exerciseById.get(row.exerciseId);
    if (row.setType === 'warmup' || !facts) continue;

    const bodyPart = MUSCLE_TO_BODY_PART[facts.primaryMuscle];
    const inCurrent = row.startedAt.getTime() >= startOfCurrent;

    if (!DISTRIBUTION_AXES.includes(bodyPart)) {
      if (inCurrent) unplottedSets += 1;
      continue;
    }

    const bucket = inCurrent ? current : previous;
    bucket.set(bodyPart, (bucket.get(bodyPart) ?? 0) + 1);
  }

  const axes = DISTRIBUTION_AXES.map((bodyPart) => ({
    bodyPart,
    current: current.get(bodyPart) ?? 0,
    previous: previous.get(bodyPart) ?? 0,
  }));

  const totals = emptyTotals();
  const previousTotals = emptyTotals();

  for (const session of sessions) {
    const target = session.startedAt.getTime() >= startOfCurrent ? totals : previousTotals;
    target.workouts += 1;
    target.durationSeconds += session.durationSeconds ?? 0;
    target.volumeKg += session.totalVolumeKg;
    target.sets += session.totalSets;
  }

  return {
    range,
    axes,
    totals,
    previousTotals: window.previous ? previousTotals : null,
    peak: axes.reduce((max, axis) => Math.max(max, axis.current, axis.previous), 0),
    unplottedSets,
  };
}

function emptyTotals(): DistributionTotals {
  return { workouts: 0, durationSeconds: 0, volumeKg: 0, sets: 0 };
}

/**
 * Finished sessions in a window, read from the denormalised totals on
 * `workouts`: no set-level join needed to answer "how much, for how long".
 */
export async function loadSessions(
  from: Date | null,
  to: Date | null,
): Promise<
  {
    id: string;
    startedAt: Date;
    durationSeconds: number | null;
    totalVolumeKg: number;
    totalSets: number;
    totalReps: number;
    prCount: number;
    name: string;
  }[]
> {
  const filters = [isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)];
  if (from) filters.push(gte(workouts.startedAt, from));
  if (to) filters.push(lt(workouts.startedAt, to));

  return db
    .select({
      id: workouts.id,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      totalVolumeKg: workouts.totalVolumeKg,
      totalSets: workouts.totalSets,
      totalReps: workouts.totalReps,
      prCount: workouts.prCount,
      name: workouts.name,
    })
    .from(workouts)
    .where(and(...filters));
}

// ---------------------------------------------------------------------------
// One session's split
// ---------------------------------------------------------------------------

/** The minimum an exercise block has to carry to be split by body part. */
export interface SplittableBlock {
  exercise: { primaryMuscle: MuscleGroup };
  sets: readonly { setType: SetType; isCompleted: boolean }[];
}

export interface MuscleSplitSlice {
  bodyPart: BodyPart;
  sets: number;
  /** Fraction of the session's working sets, 0–1. */
  share: number;
}

/**
 * How one session's work divided across the body, largest share first.
 *
 * Computed from the blocks the detail screen has already loaded rather than
 * from a query of its own. The sets are in memory, and this is a dozen
 * additions.
 *
 * The attribution rule is deliberately the same one `getMuscleDistribution`
 * uses: completed working sets, credited whole to the exercise's *primary*
 * muscle only. Spreading a set across its secondary muscles at a discount is
 * right for "how much work has this muscle had lately", which is a question
 * about stimulus; it is wrong here, where the percentages have to add to 100
 * and be checkable against the session's own set count sitting two lines above.
 */
export function workoutMuscleSplit(blocks: readonly SplittableBlock[]): MuscleSplitSlice[] {
  const byPart = new Map<BodyPart, number>();
  let total = 0;

  for (const block of blocks) {
    const part = MUSCLE_TO_BODY_PART[block.exercise.primaryMuscle];

    for (const set of block.sets) {
      if (!set.isCompleted || set.setType === 'warmup') continue;
      byPart.set(part, (byPart.get(part) ?? 0) + 1);
      total += 1;
    }
  }

  if (total === 0) return [];

  return [...byPart]
    .map(([bodyPart, sets]) => ({ bodyPart, sets, share: sets / total }))
    .sort((a, b) => b.sets - a.sets);
}
