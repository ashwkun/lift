/**
 * What the session on screen adds up to, while it is still happening.
 *
 * Everything the analytics screens compute, they compute from SQLite over
 * finished sessions. None of that is available mid-workout: the row is open,
 * its denormalised totals are still zero (`finishWorkout` writes them), and the
 * numbers change every time a check plate is tapped. So this folds the same
 * tallies out of the rows the logging screen already holds in memory, which
 * costs one pass over a handful of sets and stays live for free.
 *
 * The muscle weighting is deliberately identical to `muscle-stats`: the target
 * muscle whole, every assisting muscle at `SECONDARY_SET_WEIGHT`. Two places in
 * the app now answer "which muscles did this train", and they must not disagree
 * about the answer for the same session.
 */

import {
  summarizeSets,
  type AnalyticsContext,
  type MuscleGroup,
  type SetLike,
} from '@lift/shared';
import { and, desc, eq, gt, isNotNull, isNull, lt, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import { workouts, type Workout } from '@/db/schema';
import { SECONDARY_SET_WEIGHT } from '@/features/analytics/repository';

import type { WorkoutExerciseDetail } from './repository';

// ---------------------------------------------------------------------------
// The live session
// ---------------------------------------------------------------------------

export interface MuscleShare {
  muscle: MuscleGroup;
  /** Working sets, assisting ones counted at `SECONDARY_SET_WEIGHT`. Fractional. */
  sets: number;
  /**
   * Sets where this muscle was the target. Whole, and zero for a muscle that
   * only ever assisted, which is what the breakdown marks differently.
   */
  directSets: number;
  /** This muscle's share of the session's weighted sets, 0–1. */
  share: number;
}

export interface SessionInsights {
  /** Completed working sets, summed in kilograms. */
  volumeKg: number;
  /** Reps across completed working sets. */
  reps: number;
  /** Completed working sets. Warm-ups are not counted; see `isWorkingSet`. */
  workingSets: number;
  /** Exercises with at least one set checked off. */
  exercises: number;
  /** Every muscle this session has touched, busiest first. */
  muscles: MuscleShare[];
  /** Muscle → weighted sets, the shape `SessionBodyMap` reads. */
  setsByMuscle: Partial<Record<MuscleGroup, number>>;
  /** The denominator behind every `share`. */
  weightedSets: number;
}

const EMPTY: SessionInsights = {
  volumeKg: 0,
  reps: 0,
  workingSets: 0,
  exercises: 0,
  muscles: [],
  setsByMuscle: {},
  weightedSets: 0,
};

/**
 * One pass over the session's exercises.
 *
 * Completed sets only, throughout. An uncompleted row is a plan rather than a
 * record: it carries a weight and a rep count the moment it is created (the
 * ghost fill), so counting it would have the session open at full volume before
 * a single set had been done, and the figure would then fall as the user typed
 * real numbers in.
 */
export function summariseSession(
  details: readonly WorkoutExerciseDetail[],
  context: Pick<AnalyticsContext, 'bodyweightKg' | 'formula'>,
): SessionInsights {
  if (details.length === 0) return EMPTY;

  let volumeKg = 0;
  let reps = 0;
  let workingSets = 0;
  let exercises = 0;

  const byMuscle = new Map<MuscleGroup, MuscleShare>();

  const touch = (muscle: MuscleGroup): MuscleShare => {
    let entry = byMuscle.get(muscle);
    if (!entry) {
      entry = { muscle, sets: 0, directSets: 0, share: 0 };
      byMuscle.set(muscle, entry);
    }
    return entry;
  };

  for (const detail of details) {
    const ctx: AnalyticsContext = {
      trackingType: detail.exercise.trackingType,
      bodyweightKg: context.bodyweightKg,
      formula: context.formula,
    };

    const summary = summarizeSets(detail.sets as SetLike[], ctx);
    if (summary.workingSets === 0) continue;

    volumeKg += summary.volumeKg;
    reps += summary.totalReps;
    workingSets += summary.workingSets;
    exercises += 1;

    const primary = touch(detail.exercise.primaryMuscle);
    primary.sets += summary.workingSets;
    primary.directSets += summary.workingSets;

    // A row written by an older build or arriving from a sync peer may not
    // carry an array, the same defence `muscle-stats` takes on the way out of
    // SQLite.
    const secondaries = Array.isArray(detail.exercise.secondaryMuscles)
      ? detail.exercise.secondaryMuscles
      : [];

    for (const muscle of secondaries) {
      if (muscle === detail.exercise.primaryMuscle) continue;
      touch(muscle).sets += summary.workingSets * SECONDARY_SET_WEIGHT;
    }
  }

  const muscles = [...byMuscle.values()].sort((a, b) => b.sets - a.sets);
  const weightedSets = muscles.reduce((total, entry) => total + entry.sets, 0);

  const setsByMuscle: Partial<Record<MuscleGroup, number>> = {};
  for (const entry of muscles) {
    entry.share = weightedSets > 0 ? entry.sets / weightedSets : 0;
    setsByMuscle[entry.muscle] = entry.sets;
  }

  return { volumeKg, reps, workingSets, exercises, muscles, setsByMuscle, weightedSets };
}

// ---------------------------------------------------------------------------
// Last time
// ---------------------------------------------------------------------------

export interface SessionBaseline {
  workoutId: string;
  name: string;
  startedAt: Date;
  volumeKg: number;
  sets: number;
  reps: number;
  /**
   * How this session was chosen, which is what the caption has to say. "Last
   * Push Day" and "your last session" are different claims, and offering the
   * second while meaning the first is how a comparison stops being trusted.
   */
  match: 'routine' | 'name' | 'recent';
}

/**
 * The finished session this one should be measured against.
 *
 * Three attempts, narrowest first, because "last time" means the last time you
 * did *this*. A session started from a routine has an unambiguous predecessor,
 * so that is asked for first. Failing that, the same session name, which is how
 * anyone repeating a workout without a routine actually marks it. Only when
 * neither exists does it fall back to the most recent session, and the caller
 * says so rather than implying a like-for-like.
 *
 * Sessions that finished with no working sets are excluded at every step: an
 * abandoned session is not a bar to clear, and comparing against its zeroes
 * would report an infinite improvement on the first set of the day.
 */
export async function getSessionBaseline(workout: Workout): Promise<SessionBaseline | null> {
  const earlier = [
    isNotNull(workouts.finishedAt),
    isNull(workouts.deletedAt),
    ne(workouts.id, workout.id),
    // Started before this one rather than merely "not this one", so editing an
    // old session cannot be compared against its own future. Same reasoning as
    // `PreviousPerformanceOptions.before`.
    lt(workouts.startedAt, workout.startedAt),
    gt(workouts.totalSets, 0),
  ];

  const find = async (extra = earlier) =>
    (
      await db
        .select()
        .from(workouts)
        .where(and(...extra))
        .orderBy(desc(workouts.startedAt))
        .limit(1)
    )[0];

  if (workout.routineId) {
    const previous = await find([...earlier, eq(workouts.routineId, workout.routineId)]);
    if (previous) return toBaseline(previous, 'routine');
  }

  const sameName = await find([...earlier, eq(workouts.name, workout.name)]);
  if (sameName) return toBaseline(sameName, 'name');

  const recent = await find();
  return recent ? toBaseline(recent, 'recent') : null;
}

function toBaseline(row: Workout, match: SessionBaseline['match']): SessionBaseline {
  return {
    workoutId: row.id,
    name: row.name,
    startedAt: row.startedAt,
    volumeKg: row.totalVolumeKg,
    sets: row.totalSets,
    reps: row.totalReps,
    match,
  };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export interface Progress {
  /** Signed difference, in the figure's own unit. */
  diff: number;
  /** Past the baseline, or level with it. */
  ahead: boolean;
}

/**
 * Where a live figure stands against the same figure last time.
 *
 * `ahead` exists because the sign alone is the wrong reading mid-session. Three
 * sets into a workout every total is below last time's, and painting all of
 * them red would be telling a lifter they are failing at a session they are
 * two minutes into. Behind is the expected state and is stated without alarm;
 * only clearing the bar is an event worth a colour.
 *
 * `getSessionBaseline` already refuses to return a session that logged nothing,
 * so `previous` is positive in practice and the subtraction needs no guard
 * against a baseline of zero.
 */
export function compare(current: number, previous: number): Progress {
  const diff = current - previous;
  return { diff, ahead: diff >= 0 };
}
