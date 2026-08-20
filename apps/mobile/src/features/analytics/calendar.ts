/**
 * The workout calendar: its data, and the date arithmetic its grid is drawn
 * from.
 *
 * Unlike the history screen's analytics this loads the *whole* log in one query
 * rather than a window per month. A finished workout is seven small columns and
 * even a decade of daily training is a few thousand rows — the same full scan
 * `getDashboardStats` already runs on the Profile tab — and holding it means
 * paging between months costs nothing and can't land out of order. A per-month
 * query would also have to be re-run before it could answer the two questions
 * the screen needs about months it is *not* showing: how far back the log goes,
 * and what a typical day's volume is.
 */

import { dayKey } from '@lift/shared';
import { and, asc, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { workouts } from '@/db/schema';

/** The columns a calendar row needs. Deliberately narrower than `Workout`. */
export interface CalendarWorkout {
  id: string;
  name: string;
  startedAt: Date;
  durationSeconds: number | null;
  totalVolumeKg: number;
  totalSets: number;
  prCount: number;
}

export interface CalendarDay {
  /** Local `YYYY-MM-DD`, from `@lift/shared`'s `dayKey`. */
  key: string;
  /** Local midnight of that day. */
  date: Date;
  /** Chronological within the day: a morning session reads before an evening one. */
  workouts: CalendarWorkout[];
  volumeKg: number;
  durationSeconds: number;
  sets: number;
  prCount: number;
}

export interface WorkoutCalendar {
  /** Only days that were trained. A missing key is a rest day. */
  days: Map<string, CalendarDay>;
  /** Local midnight of the earliest day trained, or null on an empty log. */
  first: Date | null;
  /**
   * The middle of the shading ramp: the median volume of a trained day.
   *
   * Median rather than the busiest day of the month on screen. Shading against
   * the visible month would make every month look alike — a deload and a peak
   * block would each show one brightest square — and the whole point of the
   * grid is that a hard month is visibly hotter than an easy one. It is also
   * why this is measured over the whole log and not a trailing window: as
   * someone gets stronger their old months should cool off, because relative to
   * what they lift now, they were lighter days.
   */
  typicalVolumeKg: number;
}

/** Local midnight of `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The first of `date`'s month, at local midnight. Identity for a month. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** `step` months either side of `monthStart`. Handles the year boundary. */
export function addMonths(monthStart: Date, step: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + step, 1);
}

/** "August 2026", in the device's locale and word order. */
export function monthLabel(monthStart: Date): string {
  return monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export async function getWorkoutCalendar(): Promise<WorkoutCalendar> {
  const rows = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      totalVolumeKg: workouts.totalVolumeKg,
      totalSets: workouts.totalSets,
      prCount: workouts.prCount,
    })
    .from(workouts)
    // Finished sessions only, the same rule the history list applies: an open
    // workout has no duration and its totals are still moving.
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(asc(workouts.startedAt));

  const days = new Map<string, CalendarDay>();

  for (const row of rows) {
    // Filed under the day it *started*. A session that runs past midnight
    // belongs to the evening it began, which is also how the history list
    // groups it — two screens disagreeing about which day a workout was on
    // would be worse than either rule.
    const key = dayKey(row.startedAt);

    let day = days.get(key);
    if (!day) {
      day = {
        key,
        date: startOfDay(row.startedAt),
        workouts: [],
        volumeKg: 0,
        durationSeconds: 0,
        sets: 0,
        prCount: 0,
      };
      days.set(key, day);
    }

    day.workouts.push(row);
    day.volumeKg += row.totalVolumeKg;
    day.durationSeconds += row.durationSeconds ?? 0;
    day.sets += row.totalSets;
    day.prCount += row.prCount;
  }

  // Days that logged no volume at all — a bodyweight-only session before a
  // bodyweight was set, a session of held planks — are trained days, but they
  // are not evidence of what a typical *volume* is, and a run of zeros would
  // drag the median to nothing and light the whole grid at full brightness.
  const volumes = [...days.values()].map((day) => day.volumeKg).filter((volume) => volume > 0);

  return {
    days,
    first: rows.length > 0 ? startOfDay(rows[0].startedAt) : null,
    typicalVolumeKg: median(volumes),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * One month laid out as whole weeks, `null` for the padding either end.
 *
 * The trailing nulls matter as much as the leading ones: without them the last
 * row of a month ending mid-week is shorter than the others, and a wrapping row
 * of equal-width cells would centre or stretch it out of the column grid.
 */
export function monthCells(monthStart: Date, firstDayOfWeek: 0 | 1): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();

  // `getDay()` is Sunday-based; this rotates it so the configured first day
  // lands in column zero.
  const lead = (new Date(year, month, 1).getDay() - firstDayOfWeek + 7) % 7;
  // Day 0 of the next month is the last day of this one.
  const length = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= length; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

/**
 * Column headings, rotated to start on the configured day.
 *
 * Both forms come back because they are read by different audiences: the
 * narrow letter is drawn (and is ambiguous — two locales in three have a pair
 * of days sharing a letter), while the long name is what each day cell
 * announces, which is why the drawn row is hidden from screen readers.
 *
 * 4 January 1970 was a Sunday, which is what makes the offset arithmetic below
 * line up with `getDay()`.
 */
export function weekdayHeadings(firstDayOfWeek: 0 | 1): { narrow: string; long: string }[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(1970, 0, 4 + ((firstDayOfWeek + index) % 7));
    return {
      narrow: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      long: date.toLocaleDateString(undefined, { weekday: 'long' }),
    };
  });
}

// ---------------------------------------------------------------------------
// Month summary
// ---------------------------------------------------------------------------

export interface MonthSummary {
  /** Everything trained that month, newest first — the order History uses. */
  workouts: CalendarWorkout[];
  volumeKg: number;
  durationSeconds: number;
  sets: number;
  prCount: number;
  /** Distinct days trained, which is not the same as `workouts.length`. */
  activeDays: number;
  daysInMonth: number;
}

export function summariseMonth(days: Map<string, CalendarDay>, monthStart: Date): MonthSummary {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const summary: MonthSummary = {
    workouts: [],
    volumeKg: 0,
    durationSeconds: 0,
    sets: 0,
    prCount: 0,
    activeDays: 0,
    daysInMonth,
  };

  // Walks the month rather than the map: a month is at most 31 lookups, where
  // scanning every day ever trained would grow with the length of the log.
  for (let day = 1; day <= daysInMonth; day++) {
    const entry = days.get(dayKey(new Date(year, month, day)));
    if (!entry) continue;

    summary.activeDays += 1;
    summary.volumeKg += entry.volumeKg;
    summary.durationSeconds += entry.durationSeconds;
    summary.sets += entry.sets;
    summary.prCount += entry.prCount;
    summary.workouts.push(...entry.workouts);
  }

  // Collected oldest-first above, so one reverse puts the month in the same
  // newest-first order as the history list.
  summary.workouts.reverse();

  return summary;
}
