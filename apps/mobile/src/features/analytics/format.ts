/**
 * Formatting shared by the analytics screens, for the figures `@lift/shared`
 * has no formatter for because they carry no unit.
 */

/**
 * A set count that may be fractional.
 *
 * Weekly rates are averages and the secondary-muscle discount is a half, so a
 * decimal is meaningful, but not a trailing `.0` on the whole numbers most
 * rows land on, which would put a decimal point in a column of counts.
 */
export function formatSets(sets: number): string {
  const rounded = Math.round(sets * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "1 set" / "12 sets", for prose rather than for a column. */
export function pluralSets(sets: number): string {
  return sets === 1 ? '1 set' : `${formatSets(sets)} sets`;
}

/** "1 session" / "9 sessions". */
export function pluralSessions(sessions: number): string {
  return sessions === 1 ? '1 session' : `${sessions} sessions`;
}
