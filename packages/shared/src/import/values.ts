/**
 * Reading the values inside an export, all of which arrive as text.
 *
 * The recurring problem is that none of these formats are declared anywhere in
 * the file. A cell reading `52,5` is 52.5 kg in Berlin and 525 nowhere; `5/6/25`
 * is May or June depending on which app wrote it. So each parser here commits to
 * a rule and returns `null` when it can't, and the caller counts the nulls —
 * that count is what the import screen shows instead of silently importing a
 * workout dated 1923.
 *
 * English month names only. Hevy writes `21 May 2025, 20:44` in whatever
 * language the app is set to, which is why the import screen says to switch it
 * to English before exporting — the same caveat LiftShift ships with.
 */

import type { SetType } from '../types.ts';

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Trailing units an exporter may have baked into the cell rather than the header. */
const UNIT_SUFFIX = /\s*(kgs?|lbs?|pounds?|kms?|mi|miles?|m|secs?|s|mins?|reps?)\.?$/i;

/**
 * A number, in whichever of the two decimal conventions the file uses.
 *
 * The convention is decided per cell rather than per file because it can be
 * read off the cell itself: `1.234,56` and `1,234.56` each pin down both
 * separators, and a lone comma with fewer than three digits after it can only
 * be a decimal point. The remaining case — `1,234` — is read as a thousands
 * group, which is the reading that is right when it matters (a weight of 1,234
 * is a formatted 1234; a weight of 1.234 kg is not a weight).
 */
export function parseNumber(value: string): number | null {
  let text = value.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (lower === '-' || lower === 'null' || lower === 'undefined' || lower === 'n/a') return null;

  text = text.replace(UNIT_SUFFIX, '').trim();
  if (!text) return null;

  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.'); // 1.234,56
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, ''); // 1,234.56 and 1,234
  } else if (text.includes(',') && !text.includes('.')) {
    text = text.replace(',', '.'); // 52,5
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A whole number, for reps and set indexes. Fractional input is rounded. */
export function parseInteger(value: string): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * Seconds, from any of the three ways apps write a duration: a bare count,
 * a clock (`1:06:25`, `2:30`), or a spelled-out span (`1h 30m`).
 *
 * A two-part clock is minutes and seconds, not hours and minutes — `2:30` on a
 * plank is two and a half minutes, and reading it as two and a half hours would
 * put a 9,000-second set in the log.
 */
export function parseSeconds(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number.parseFloat(text));

  const clock = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const c = clock[3] === undefined ? null : Number(clock[3]);
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }

  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(text);
  const minutes = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)\b/i.exec(text);
  const seconds = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i.exec(text);

  if (!hours && !minutes && !seconds) return null;

  const total =
    (hours ? Number(hours[1]) * 3600 : 0) +
    (minutes ? Number(minutes[1]) * 60 : 0) +
    (seconds ? Number(seconds[1]) : 0);

  return Math.round(total);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Which of `5/6/2025`'s first two numbers is the day. */
export type DateOrder = 'dmy' | 'mdy';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Outside this, the parse went wrong rather than the lifter being 300 years old. */
const EARLIEST_YEAR = 1990;
const LATEST_YEAR = 2100;

const TIME_PART = /[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap])\.?m\.?\s*$/i;
const TIME_PART_24 = /[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*$/;

/**
 * An epoch-ms instant, or null.
 *
 * Timestamps carrying an explicit offset are handed to the platform, because
 * they name an instant and reinterpreting one is how an import ends up an hour
 * out. Everything else is wall-clock text with no zone in it and is read as
 * local time — a session logged at 20:44 belongs at 20:44 on the phone that
 * imports it, whatever continent the export was written on.
 */
export function parseTimestamp(value: string, order: DateOrder = 'dmy'): number | null {
  const text = value.trim();
  if (!text) return null;

  // Epoch seconds or milliseconds, which is how JSON-derived CSVs write dates.
  if (/^\d{9,13}$/.test(text)) {
    const digits = Number(text);
    return plausible(text.length <= 10 ? digits * 1000 : digits);
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text) && /(z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return plausible(Date.parse(text));
  }

  // A zoneless `2025-05-21T20:44` is wall-clock text wearing ISO punctuation.
  // The `T` is the only thing separating it from the space-delimited spelling
  // every other branch below already handles.
  const { date, hour, minute, second } = splitTime(
    text.replace(/^(\d{4}-\d{1,2}-\d{1,2})[Tt]/, '$1 '),
  );

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (iso) return build(+iso[1]!, +iso[2]! - 1, +iso[3]!, hour, minute, second);

  const slashIso = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(date);
  if (slashIso) return build(+slashIso[1]!, +slashIso[2]! - 1, +slashIso[3]!, hour, minute, second);

  // "21 May 2025"
  const dayFirst = /^(\d{1,2})\.?\s+([a-z]{3,})\.?,?\s+(\d{2,4})$/i.exec(date);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return build(expandYear(+dayFirst[3]!), month, +dayFirst[1]!, hour, minute, second);
    }
  }

  // "May 21, 2025"
  const monthFirst = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i.exec(date);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return build(expandYear(+monthFirst[3]!), month, +monthFirst[2]!, hour, minute, second);
    }
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(date);
  if (numeric) {
    const first = +numeric[1]!;
    const secondPart = +numeric[2]!;
    // A component over 12 can only be the day, whatever the file-wide vote said.
    const dayFirstHere = first > 12 ? true : secondPart > 12 ? false : order === 'dmy';
    const day = dayFirstHere ? first : secondPart;
    const month = dayFirstHere ? secondPart : first;
    return build(expandYear(+numeric[3]!), month - 1, day, hour, minute, second);
  }

  return null;
}

/**
 * Decides day-first vs month-first for a whole column at once.
 *
 * Any single `13/05/2025` settles it for every ambiguous row beside it, which is
 * why this looks at the column rather than the cell: within one export the
 * convention never changes, and one unambiguous date is usually enough to find
 * it. With no evidence either way it answers day-first, the convention most of
 * the world writes and the one Hevy and Lyfta export in.
 */
export function detectDateOrder(values: readonly string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;

  for (const value of values) {
    const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(value);
    if (!match) continue;
    if (+match[1]! > 12) dayFirst += 1;
    else if (+match[2]! > 12) monthFirst += 1;
  }

  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

/** Peels a trailing clock off a timestamp, leaving the date behind. */
function splitTime(text: string): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} {
  const twelve = TIME_PART.exec(text);
  if (twelve) {
    const raw = +twelve[1]!;
    const pm = twelve[4]!.toLowerCase() === 'p';
    const hour = pm ? (raw % 12) + 12 : raw % 12;
    return {
      date: text.slice(0, twelve.index).replace(/[\s,]+$/, ''),
      hour,
      minute: +twelve[2]!,
      second: twelve[3] === undefined ? 0 : +twelve[3],
    };
  }

  const twentyFour = TIME_PART_24.exec(text);
  if (twentyFour) {
    return {
      date: text.slice(0, twentyFour.index).replace(/[\s,]+$/, ''),
      hour: +twentyFour[1]!,
      minute: +twentyFour[2]!,
      second: twentyFour[3] === undefined ? 0 : +twentyFour[3],
    };
  }

  return { date: text.replace(/[\s,]+$/, ''), hour: 0, minute: 0, second: 0 };
}

/**
 * Constructs a local instant, rejecting dates that rolled over.
 *
 * `new Date(2025, 1, 31)` is silently 3 March, so a mis-ordered `31/02` would
 * otherwise import as a real workout on the wrong day. Reading the fields back
 * is the only way to notice.
 */
function build(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  const date = new Date(year, month, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return plausible(date.getTime());
}

function plausible(ms: number): number | null {
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getFullYear();
  return year >= EARLIEST_YEAR && year <= LATEST_YEAR ? ms : null;
}

/** `25` → 2025, `98` → 1998. Four-digit years pass through. */
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

// ---------------------------------------------------------------------------
// Set types
// ---------------------------------------------------------------------------

export interface ParsedSetType {
  type: SetType;
  /**
   * False when the source drew a distinction Lift doesn't have.
   *
   * An AMRAP, a myo-rep and a cluster set all land on `normal`, which is the
   * right place for them — they are working sets and they count — but the label
   * is gone. The importer tallies these so the summary can say so, because
   * finding out later that a hundred drop sets became ordinary ones is worse
   * than being told at the time.
   */
  exact: boolean;
}

/**
 * Maps a source's set type onto the four Lift stores.
 *
 * Warm-ups are the one that has to be right: they are excluded from volume, PRs
 * and 1RM estimates everywhere in the app, so importing one as a working set
 * quietly inflates every statistic downstream of it.
 */
export function parseSetType(value: string): ParsedSetType {
  const text = value.toLowerCase().replace(/[^a-z]/g, '');

  if (!text) return { type: 'normal', exact: true };
  if (text === 'normal' || text === 'normalset' || text === 'working' || text === 'workingset') {
    return { type: 'normal', exact: true };
  }
  if (text === 'work' || text === 'regular' || text === 'standard' || text === 'set') {
    return { type: 'normal', exact: true };
  }
  if (text.startsWith('warm') || text === 'w') return { type: 'warmup', exact: true };
  if (text.startsWith('drop') || text === 'd') return { type: 'drop', exact: true };
  if (text.startsWith('fail') || text === 'f') return { type: 'failure', exact: true };

  return { type: 'normal', exact: false };
}

// ---------------------------------------------------------------------------
// Effort
// ---------------------------------------------------------------------------

/** RPE, ignoring anything outside the 1–10 scale the app stores. */
export function parseRpe(value: string): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  return parsed >= 1 && parsed <= 10 ? parsed : null;
}

/**
 * Reps-in-reserve as the RPE it means, which is what Lift stores.
 *
 * Lyfta records RIR where Hevy records RPE, and they are the same scale read
 * from opposite ends: two left in the tank is an 8. Anything past 9 in reserve
 * is a warm-up by another name and floors at 1 rather than going negative.
 */
export function rirToRpe(rir: number): number {
  return Math.max(1, Math.min(10, 10 - rir));
}
