/**
 * How a trained day is shaded, in the two palettes the app draws day grids in.
 *
 * One scale, `intensityStep`, decides what counts as a heavy day. Two ramps
 * paint it, and which one a surface uses is a decision about that surface's
 * accent budget rather than about the data:
 *
 * - `dayFill` runs the muted surface towards the accent. For grids that are the
 *   *subject* of their screen: `MonthGrid` on Calendar, `ContributionGraph` on
 *   History.
 * - `dayShade` runs `borderStrong` towards `textSecondary`. For grids that are
 *   one block among several, where the accent is already spent on something
 *   else. Home's `CalendarWidget` is the only one today.
 *
 * They live together because they are two readings of one scale, and a scale
 * whose halves sit in different files drifts: a step added to one ramp and not
 * the other would make the same day a different intensity on two screens.
 *
 * This was a component file's private section until it had three consumers. A
 * pure function that takes a number and a palette and returns a colour is not
 * part of a grid, and importing `MonthGrid` to reach one was the tell.
 */

import { mix, type Palette } from '@/theme';

/**
 * How far each step of the ramp travels from the muted surface towards the
 * accent.
 *
 * Four steps rather than a continuous gradient. A day's volume is a coarse
 * signal: the difference between 8,000 kg and 8,400 kg is noise, and rendering
 * it as a visible shade difference invites the reader to compare two squares
 * that are not meaningfully different. Steps also make the legend honest: four
 * swatches can be shown, a gradient can only be gestured at.
 *
 * The floor sits at 0.38 rather than just off the surface it starts from,
 * because the lightest trained day still has to read as *trained*: there it
 * measures 3.57:1 against the dark card and 1.93:1 against the light one. The
 * light palette cannot reach 3:1 at the bottom of the ramp. Its card is white
 * and its accent a mid olive, so a first step that contrasted that strongly
 * would have to start two thirds of the way up and the three above it would
 * have nowhere left to go. What backs it up there is the day number, which
 * changes colour on a trained square, and the label a screen reader is given.
 *
 * The top stops just short of the raw accent so the busiest day of a month
 * reads as the end of a scale rather than as a button. Every step's number
 * clears 5:1 against its own fill in both palettes: see `readableOn`.
 */
const RAMP = [0.38, 0.58, 0.77, 0.96];

/**
 * The neutral ramp, at the same four steps.
 *
 * It starts higher and ends lower than `RAMP` because it has less room to work
 * in: `borderStrong` to `textSecondary` is a narrower span than a muted surface
 * to the accent, so the stops are spread to keep four distinguishable shades
 * inside it rather than clustered at one end.
 *
 * Both ends are defined in every palette and move together, so on the light
 * ones the ramp runs light to dark. That is the same "heavier is stronger" in
 * reverse, and it is the convention the volume run and the body-part bars on
 * Home already read in.
 */
const SHADE = [0.25, 0.45, 0.68, 0.9];

/**
 * Which step of the ramp a day's volume lands on, against the typical day.
 *
 * Absolute, not relative to the month on screen: see `typicalVolumeKg` in
 * `calendar.ts` for why. A day at the median sits on step 1, half again on
 * step 2, and 1.5x the median or more tops the scale. Most training days land
 * on the middle two steps, which is what leaves the outliers visible.
 */
export function intensityStep(volumeKg: number, typicalVolumeKg: number): number {
  if (volumeKg <= 0 || typicalVolumeKg <= 0) return 0;

  const ratio = volumeKg / typicalVolumeKg;
  if (ratio < 0.6) return 0;
  if (ratio < 1) return 1;
  if (ratio < 1.5) return 2;
  return 3;
}

/** The accent ramp, for a grid that is the subject of its screen. */
export function dayFill(step: number, colors: Palette): string {
  return mix(colors.surfaceMuted, colors.accent, RAMP[step] ?? RAMP[0]);
}

/** The neutral ramp, for a grid sharing a screen with a louder element. */
export function dayShade(step: number, colors: Palette): string {
  return mix(colors.borderStrong, colors.textSecondary, SHADE[step] ?? SHADE[0]);
}

/** The accent ramp's four stops, for the legend under a grid. */
export function rampSamples(colors: Palette): string[] {
  return RAMP.map((_, step) => dayFill(step, colors));
}
