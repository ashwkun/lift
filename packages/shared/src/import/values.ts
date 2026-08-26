/**
 * Reading the values inside an export, all of which arrive as text.
 *
 * The recurring problem is that none of these formats are declared anywhere in
 * the file. A cell reading `52,5` is 52.5 kg in Berlin and 525 nowhere; `5/6/25`
 * is May or June depending on which app wrote it. So each parser here commits to
 * a rule and returns `null` when it can't, and the caller counts the nulls.
 * That count is what the import screen shows instead of silently importing a
 * workout dated 1923.
 *
 * Hevy writes `21 May 2025, 20:44` using the phone's locale, so the month word
 * arrives in whatever language the app is set to and the file carries no hint
 * of which one that was. The month and set-type tables below therefore read
 * twenty-one Latin-script locales rather than English alone. Which twenty-one,
 * and which languages were deliberately left out, is argued where the tables
 * are defined.
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
 * be a decimal point. The remaining case (`1,234`) is read as a thousands
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
 * A two-part clock is minutes and seconds, not hours and minutes: `2:30` on a
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
// Folding
// ---------------------------------------------------------------------------

/**
 * Latin letters that survive NFD, spelled out.
 *
 * Stripping combining marks turns ä into a, ç into c and ş into s, which covers
 * nearly every accented word these tables have to read. The ones here are
 * atomic codepoints with no base letter underneath, so the strip leaves them
 * and the following `[^a-z]` filter would delete them outright. Turkish is what
 * makes this worth writing: `Mayıs` and `Kasım` would otherwise lose a letter
 * rather than an accent, and `ısınma` would start with the wrong one.
 */
const ATOMIC_LETTERS: Record<string, string> = {
  ı: 'i', ø: 'o', ł: 'l', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd',
};

/**
 * A word reduced to bare lower-case ASCII letters.
 *
 * One entry per table then covers every way a source might punctuate it:
 * `Mär`, `mar` and `MAR` fold together, as do `déc.` and `dec`. Everything that
 * is not a letter goes, so `Warm Up` and `warm-up` fold to the same token.
 */
function fold(word: string): string {
  let folded = '';
  for (const char of word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')) {
    folded += ATOMIC_LETTERS[char] ?? char;
  }
  return folded.replace(/[^a-z]/g, '');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Which of `5/6/2025`'s first two numbers is the day. */
export type DateOrder = 'dmy' | 'mdy';

/**
 * Month words that a three-letter prefix would read as the wrong month.
 *
 * Checked before `MONTH_PREFIXES`, and that ordering is the whole point. Three
 * prefixes turned out to name two different months across the supported set:
 *
 * - `mar` is March in fourteen spellings and the start of Finnish `marras`,
 *   which is November. A Finnish export read by prefix would land every
 *   November workout in March, silently, which is the failure this module
 *   exists to avoid. So `mar` is not a prefix at all: every March spelling is
 *   listed here by hand, and anything else beginning `mar` falls through to
 *   null and gets counted as unreadable.
 * - `jui` is French `juin` (June) and `juil`/`juillet` (July). French
 *   abbreviates to four letters precisely because three do not separate them.
 * - `cer` is Czech `červen` (June) and `červenec` (July), the same trap.
 *
 * `marrask` is here for a Finnish form `Intl` will not show you: Finnish medium
 * dates are numeric, so the format-context abbreviations (`tammik.`,
 * `marrask.`) never appear in a formatted date even though CLDR defines them.
 * Only November needs listing, because the other eleven keep a prefix that is
 * already unambiguous.
 *
 * `ag` is Catalan August, the one abbreviation shorter than a prefix.
 */
const MONTH_WORDS: Record<string, number> = {
  mar: 2, marc: 2, marca: 2, march: 2, marco: 2, marec: 2,
  maret: 2, mars: 2, mart: 2, martie: 2, marts: 2, marz: 2,
  marzec: 2, marzo: 2, cerven: 5, cervna: 5, juin: 5, cervence: 6,
  cervenec: 6, juil: 6, juillet: 6, ag: 7, marras: 10, marrask: 10,
  marraskuu: 10, marraskuuta: 10,
};

/**
 * The first three letters of a month name, where three letters are enough.
 *
 * Generated by folding every short, long and format-context month name
 * `Intl.DateTimeFormat` gives for en, en-GB, es, pt, fr, de, it, nl, sv, da,
 * nb, fi, pl, cs, sk, sl, tr, ro, id, ms and ca, then keeping only the prefixes
 * on which all of those locales agree. That is 274 distinct words collapsing to
 * these 82 entries plus the 26 above, and it is prefixes rather than whole
 * words so that a spelling CLDR has since revised still reads correctly.
 *
 * Rejected, and worth recording so nobody adds them back:
 *
 * - Croatian. `lis` is `listopad`, November in Polish and Czech and October in
 *   Croatian; `lip` is June there and July in Polish; `srp` is July there and
 *   August in Czech. The words are identical, the months are not, and a CSV
 *   carries nothing that says which language wrote it. Polish and Czech win on
 *   population by roughly twelve to one, so Croatian exports read three months
 *   wrong. Supporting both would need a locale the file does not have.
 *   Serbian, Bosnian and Slovene are safe: their CLDR names are the
 *   Latin-derived `jan`/`feb`/`mar` set and are already covered here.
 * - Hungarian and Latvian. Both write the year first (`2025. máj. 21.`), which
 *   no branch below reads, so their month words would buy nothing.
 * - Russian, Ukrainian, Greek, Arabic, Hebrew, Vietnamese, and the CJK
 *   languages. Not a table problem: they need a different date shape
 *   (a trailing `г.`, a genitive stem, `Tháng 3` as a month word), which is the
 *   large half of this job and not this change.
 *
 * Unrecognised words are not guessed at. They return null and the import screen
 * reports the count, which is the whole contract of this file.
 */
const MONTH_PREFIXES: Record<string, number> = {
  abr: 3, ago: 7, agu: 7, aou: 7, apr: 3, ara: 11, aug: 7, avg: 7,
  avr: 3, bre: 2, cvc: 6, cvn: 5, cze: 5, dec: 11, des: 11, dez: 11,
  dic: 11, dis: 11, dub: 3, eki: 9, elo: 7, ene: 0, eyl: 8, feb: 1,
  fev: 1, gen: 0, giu: 5, gru: 11, haz: 5, hei: 6, hel: 1, huh: 3,
  ian: 0, iul: 6, iun: 5, jan: 0, jou: 11, jul: 6, jun: 5, kas: 10,
  kes: 5, kve: 4, kwi: 3, led: 0, lip: 6, lis: 10, lok: 9, lug: 6,
  lut: 1, maa: 2, mac: 2, mag: 4, mai: 4, maj: 4, may: 4, mei: 4,
  mrt: 2, nis: 3, noi: 10, nov: 10, oca: 0, oct: 9, ogo: 7, okt: 9,
  ott: 9, out: 9, paz: 9, pro: 11, rij: 9, sep: 8, set: 8, sie: 7,
  srp: 7, sty: 0, sub: 1, syy: 8, tam: 0, tem: 6, tou: 4, uno: 1,
  wrz: 8, zar: 8,
};

/** The month a written name refers to, or undefined when no table claims it. */
function monthFromWord(word: string): number | undefined {
  const folded = fold(word);
  return MONTH_WORDS[folded] ?? MONTH_PREFIXES[folded.slice(0, 3)];
}

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
 * local time. A session logged at 20:44 belongs at 20:44 on the phone that
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

  // "21 May 2025", and its localised spellings: "21. Mai 2025", "21 mai 2025",
  // "21 de mai. de 2025", "21 d'abril del 2025". The letter class is `\p{L}`
  // rather than `[a-z]` because most of these months carry an accent, and the
  // optional `de`/`del`/`d'` is what Portuguese, Spanish and Catalan put
  // between the parts. Two letters is the floor because Catalan abbreviates
  // August to `ag.`.
  const dayFirst =
    /^(\d{1,2})\.?\s+(?:d[’']|del\s+|de\s+)?(\p{L}{2,})\.?,?\s+(?:d[’']|del\s+|de\s+)?(\d{2,4})$/iu.exec(
      date,
    );
  if (dayFirst) {
    const month = monthFromWord(dayFirst[2]!);
    if (month !== undefined) {
      return build(expandYear(+dayFirst[3]!), month, +dayFirst[1]!, hour, minute, second);
    }
  }

  // "May 21, 2025"
  const monthFirst = /^(\p{L}{2,})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/iu.exec(date);
  if (monthFirst) {
    const month = monthFromWord(monthFirst[1]!);
    if (month !== undefined) {
      return build(expandYear(+monthFirst[3]!), month, +monthFirst[2]!, hour, minute, second);
    }
  }

  // The space after each separator is Czech and Slovak, which write `21. 1.
  // 2025`. Tolerating it here is what stops those two locales falling through
  // to null now that their month words are recognised everywhere else.
  const numeric = /^(\d{1,2})[/.-]\s*(\d{1,2})[/.-]\s*(\d{2,4})$/.exec(date);
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
    const match = /^\s*(\d{1,2})[/.-]\s*(\d{1,2})[/.-]\s*\d{2,4}/.exec(value);
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
   * right place for them (they are working sets and they count) but the label
   * is gone. The importer tallies these so the summary can say so, because
   * finding out later that a hundred drop sets became ordinary ones is worse
   * than being told at the time.
   */
  exact: boolean;
}

/**
 * The words the source apps use for each type, folded to bare letters.
 *
 * Matched as substrings, which is what lets one entry read `échauffement`,
 * `Série d'échauffement` and `Échauffement 1`. Every entry is the ordinary word
 * for the concept in its language and cannot turn up inside a label meaning
 * something else, with one exception handled by the order they are checked in:
 * German `Aufwärmsatz`, Dutch `opwarmset` and Spanish `serie de calentamiento`
 * all contain the word for "set", so the normal-set list has to be read last.
 *
 * A word that is in none of these lists still lands on `normal`, flagged
 * inexact, and the importer reports the count. So a gap here costs a line in
 * the summary; only a false warm-up costs a number, which is why that list is
 * the most conservative of the four.
 */
const WARMUP_WORDS = [
  // en/de/nl share `warm`; the Nordic languages spell it with a v.
  'warm', 'varm',
  'calenta', 'aqueci', 'echauff', 'riscald', 'escalfa', // es, pt, fr, it, ca
  'lammittel', 'rozgrzew', 'zahriv', 'zahriev', 'rozcvic', 'ogrevan', // fi, pl, cs, sk, sl
  'isinma', 'incalzi', 'pemanas', // tr, ro, id and ms
];

const DROP_WORDS = [
  // Most languages borrow "drop set" outright, including as `Dropsatz` and
  // `dropsæt`; these are the ones that translated it instead.
  'drop',
  'descend', 'discend', 'degressi', 'reduktion', // es and en, it, fr, de
];

const FAILURE_WORDS = [
  'fail', 'fall', 'falen', 'falha', 'echec', 'versagen', 'cediment', 'upad',
  // en, es (`fallo`), nl, pt, fr, de, it, pl (`do upadku`)
];

const NORMAL_WORDS = [
  'norma', 'work', 'regular', 'standard',
  'arbeit', 'arbets', 'arbejds', 'arbeids', // de, sv, da, nb
  'trabaj', 'trabalh', 'travail', 'lavoro', 'werk', // es, pt, fr, it, nl
  'robocz', 'pracovn', 'calisma', 'kerja', // pl, cs and sk, tr, id and ms
  // Last because a Romance drop set or warm-up is also a `serie`, and those
  // lists are read first.
  'seri',
];

/**
 * Maps a source's set type onto the four Lift stores.
 *
 * Warm-ups are the one that has to be right: they are excluded from volume, PRs
 * and 1RM estimates everywhere in the app, so importing one as a working set
 * quietly inflates every statistic downstream of it.
 */
export function parseSetType(value: string): ParsedSetType {
  const text = fold(value);

  if (!text) return { type: 'normal', exact: true };

  // Strong's single-letter shorthand, matched whole. As substrings these would
  // claim almost every word in the lists above.
  if (text === 'w') return { type: 'warmup', exact: true };
  if (text === 'd') return { type: 'drop', exact: true };
  if (text === 'f') return { type: 'failure', exact: true };

  if (WARMUP_WORDS.some((word) => text.includes(word))) return { type: 'warmup', exact: true };
  if (DROP_WORDS.some((word) => text.includes(word))) return { type: 'drop', exact: true };
  if (FAILURE_WORDS.some((word) => text.includes(word))) return { type: 'failure', exact: true };
  if (text === 'set' || NORMAL_WORDS.some((word) => text.includes(word))) {
    return { type: 'normal', exact: true };
  }

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
