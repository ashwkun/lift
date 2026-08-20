/**
 * The monthly recap.
 *
 * One month, read against the eleven before it — a bar chart for the shape of
 * the year, four figures for the month itself, and the handful of sessions and
 * lifts that made it what it was.
 */

import { formatDurationShort, formatVolume, MUSCLE_GROUP_LABELS, type WeightUnit } from '@lift/shared';
import { and, asc, gte, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { personalRecords, workouts } from '@/db/schema';

import { getExercisesBetween, type LiftingContext, type MainExercise } from './exercise-stats';
import { getMuscleBoard, loadSessions, type MuscleTally } from './muscle-stats';
import { addMonths, startOfMonth } from './windows';

/** How many months the bar chart carries, including the month being reported. */
export const REPORT_MONTHS = 12;

export const REPORT_METRICS = [
  { value: 'workouts', label: 'Workouts' },
  { value: 'duration', label: 'Duration' },
  { value: 'volume', label: 'Volume' },
  { value: 'sets', label: 'Sets' },
  { value: 'reps', label: 'Reps' },
] as const;

export type ReportMetric = (typeof REPORT_METRICS)[number]['value'];

export interface MonthTotals {
  workouts: number;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
  reps: number;
}

export interface MonthBucket extends MonthTotals {
  /** Epoch ms of the first of the month. Doubles as the bucket's identity. */
  start: number;
  label: string;
}

export interface SessionHighlight {
  id: string;
  name: string;
  startedAt: number;
  durationSeconds: number;
  volumeKg: number;
  sets: number;
}

export interface MonthlyReport {
  monthStart: number;
  /** Exclusive. */
  monthEnd: number;
  title: string;
  /** Trailing `REPORT_MONTHS`, oldest first, ending on the reported month. */
  series: MonthBucket[];
  totals: MonthTotals;
  /** Null when the month before predates the log — nothing to compare against. */
  previous: MonthTotals | null;
  /** Calendar days with a finished workout. */
  activeDays: number;
  daysInMonth: number;
  /** Records filed during the month. */
  prCount: number;
  /** Most-performed lifts, at most three. */
  topExercises: MainExercise[];
  /** Busiest muscles by direct sets, at most three. */
  topMuscles: MuscleTally[];
  longestSession: SessionHighlight | null;
  biggestSession: SessionHighlight | null;
  /** Month of the first finished workout — the floor for the back arrow. */
  earliestMonth: number | null;
}

function emptyTotals(): MonthTotals {
  return { workouts: 0, durationSeconds: 0, volumeKg: 0, sets: 0, reps: 0 };
}

/** Pulls one metric off a bucket, so the chart can switch without refetching. */
export const REPORT_METRIC_VALUE: Record<ReportMetric, (totals: MonthTotals) => number> = {
  workouts: (totals) => totals.workouts,
  duration: (totals) => totals.durationSeconds,
  volume: (totals) => totals.volumeKg,
  sets: (totals) => totals.sets,
  reps: (totals) => totals.reps,
};

/**
 * Everything the report screen shows, for the month containing `month`.
 *
 * The whole twelve-month series is fetched rather than just the month itself:
 * it is one query either way — sessions carry their own totals — and it means
 * the metric toggle above the chart is instant and the previous month's figures
 * are already in hand for the comparisons.
 */
export async function getMonthlyReport(
  month: Date,
  ctx: LiftingContext = {},
): Promise<MonthlyReport> {
  const monthStart = startOfMonth(month);
  const monthEnd = addMonths(monthStart, 1);
  const seriesStart = addMonths(monthStart, -(REPORT_MONTHS - 1));

  const [sessions, board, exercises, prRows, firstRow] = await Promise.all([
    loadSessions(seriesStart, monthEnd),
    getMuscleBoard(monthStart, monthEnd),
    getExercisesBetween(monthStart, monthEnd, ctx),
    db
      .select({ id: personalRecords.id })
      .from(personalRecords)
      .where(
        and(
          isNull(personalRecords.deletedAt),
          gte(personalRecords.achievedAt, monthStart),
          lt(personalRecords.achievedAt, monthEnd),
        ),
      ),
    db
      .select({ startedAt: workouts.startedAt })
      .from(workouts)
      .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(asc(workouts.startedAt))
      .limit(1),
  ]);

  const buckets = new Map<number, MonthBucket>();
  for (let i = 0; i < REPORT_MONTHS; i++) {
    const start = addMonths(seriesStart, i);
    buckets.set(start.getTime(), {
      start: start.getTime(),
      label: start.toLocaleDateString(undefined, { month: 'short' }),
      ...emptyTotals(),
    });
  }

  let longestSession: SessionHighlight | null = null;
  let biggestSession: SessionHighlight | null = null;

  for (const session of sessions) {
    const bucket = buckets.get(startOfMonth(session.startedAt).getTime());
    if (!bucket) continue; // a clock change could land a row outside its window

    bucket.workouts += 1;
    bucket.durationSeconds += session.durationSeconds ?? 0;
    bucket.volumeKg += session.totalVolumeKg;
    bucket.sets += session.totalSets;
    bucket.reps += session.totalReps;

    if (bucket.start !== monthStart.getTime()) continue;

    const highlight: SessionHighlight = {
      id: session.id,
      name: session.name,
      startedAt: session.startedAt.getTime(),
      durationSeconds: session.durationSeconds ?? 0,
      volumeKg: session.totalVolumeKg,
      sets: session.totalSets,
    };

    if (!longestSession || highlight.durationSeconds > longestSession.durationSeconds) {
      longestSession = highlight;
    }
    if (!biggestSession || highlight.volumeKg > biggestSession.volumeKg) {
      biggestSession = highlight;
    }
  }

  const series = [...buckets.values()].sort((a, b) => a.start - b.start);
  const totals = buckets.get(monthStart.getTime()) ?? { start: 0, label: '', ...emptyTotals() };

  const earliest = firstRow[0]?.startedAt ?? null;
  const earliestMonth = earliest ? startOfMonth(earliest).getTime() : null;
  const previousStart = addMonths(monthStart, -1).getTime();
  const previousBucket = buckets.get(previousStart);

  return {
    monthStart: monthStart.getTime(),
    monthEnd: monthEnd.getTime(),
    title: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    series,
    totals,
    // A zero previous month is a real comparison — a month off is information.
    // A month that predates the log entirely is not, and "↑ 12 workouts" from
    // before the user owned the app is a number they never earned.
    previous:
      earliestMonth !== null && previousStart >= earliestMonth
        ? (previousBucket ?? emptyTotals())
        : null,
    activeDays: board.days.filter((day) => day.workouts > 0).length,
    daysInMonth: board.days.length,
    prCount: prRows.length,
    topExercises: exercises.exercises.slice(0, 3),
    topMuscles: [...board.muscles].sort((a, b) => b.directSets - a.directSets).slice(0, 3),
    longestSession,
    biggestSession,
    earliestMonth,
  };
}

/**
 * The recap as plain text, for the share sheet.
 *
 * Text rather than an image: an image needs a rendering pass and a temp file,
 * and what someone pastes into a group chat is read, not admired. Figures use
 * the same formatters the screen does, so the shared copy and the screen it was
 * shared from can never disagree.
 */
export function monthlyReportShareText(report: MonthlyReport, weightUnit: WeightUnit): string {
  const lines = [
    `${report.title} — Lift`,
    '',
    `Workouts: ${report.totals.workouts} across ${report.activeDays} of ${report.daysInMonth} days`,
    `Time: ${formatDurationShort(report.totals.durationSeconds)}`,
    `Volume: ${formatVolume(report.totals.volumeKg, weightUnit)}`,
    `Sets: ${report.totals.sets.toLocaleString()} · Reps: ${report.totals.reps.toLocaleString()}`,
  ];

  if (report.prCount > 0) {
    lines.push(`Records: ${report.prCount === 1 ? '1 PR' : `${report.prCount} PRs`}`);
  }

  const muscle = report.topMuscles[0];
  if (muscle) {
    lines.push(`Most trained: ${MUSCLE_GROUP_LABELS[muscle.muscle]} (${muscle.directSets} sets)`);
  }

  const exercise = report.topExercises[0];
  if (exercise) {
    lines.push(
      `Top lift: ${exercise.name} — ${exercise.times === 1 ? '1 session' : `${exercise.times} sessions`}`,
    );
  }

  return lines.join('\n');
}
