/**
 * When something happened, printed the way the log reads it.
 *
 * A training log is a list of events, and the hour is part of the event: two
 * sessions on the same square of the calendar are told apart by it, "was that
 * the morning session or the evening one?" is answered by it, and a record set
 * at 6am reads differently from one set after work. The app used to print the
 * date alone nearly everywhere and the clock only inside the calendar's day
 * panel, so the one screen that showed the time was the one screen where the
 * date was already known.
 *
 * The shapes below are the date halves. They are constants rather than inline
 * literals so that "a row in a list" looks the same in the history list, on the
 * dashboard and in a monthly report, instead of each screen choosing its own
 * arrangement of weekday, month and year.
 */

/** The clock, in the device's own convention: "6:30 pm" here, "18:30" elsewhere. */
const TIME_OF_DAY: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** "Sat, 12 Apr" — a row under a heading that already names the month. */
export const DATE_SHORT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
};

/** "12 Apr 2026" — a date that has to stand on its own, outside any grouping. */
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/** "Saturday, 12 April 2026" — the heading of a screen about one session. */
export const DATE_LONG: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** Just the clock: "6:30 pm". */
export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, TIME_OF_DAY);
}

/**
 * A date and the clock, joined by the app's separator: "Sat, 12 Apr · 6:30 pm".
 *
 * The date half is whatever shape the caller asks for; omitting it gives the
 * locale's own numeric date, which is what the compact list rows use.
 *
 * The middle dot is the same one every other secondary line in the app joins
 * its parts with, so a caption that already reads "date · duration · volume"
 * gains a segment rather than a second punctuation style.
 */
export function formatDateTime(date: Date, dateOptions?: Intl.DateTimeFormatOptions): string {
  return `${date.toLocaleDateString(undefined, dateOptions)} · ${formatTimeOfDay(date)}`;
}
