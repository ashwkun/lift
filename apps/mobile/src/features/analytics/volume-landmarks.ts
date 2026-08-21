import type { VolumeLandmarks } from '@lift/shared';

import { mix } from '@/theme/color';
import type { Palette } from '@/theme/tokens';

/**
 * The colour a set count is drawn in, given the landmarks it is judged against.
 *
 * The landmarks themselves live in `@lift/shared` — they are per muscle, and the
 * API and the sync engine have as much claim on them as the statistics screens
 * do. What is left here is the part that is only ever true of this app: how a
 * week's volume becomes a colour on a body map.
 */

// ---------------------------------------------------------------------------
// Colour ramp
// ---------------------------------------------------------------------------

/**
 * The ramp, anchored to the landmarks rather than to even percentage steps.
 *
 * Colour changes fastest where the boundaries actually mean something, so two
 * muscles that sit either side of `mev` look different even when their set
 * counts are close. Past `mrv` — the recoverable ceiling — the ramp leaves the
 * accent hue entirely: an overreached muscle should not read as "more of a good
 * thing", which is the one thing a single-hue opacity ramp can never express.
 *
 * Rows whose `mv` and `mev` are zero (glutes, abs, traps — the muscles fed by
 * work logged against something else) collapse the first two stops onto zero,
 * so their ramp starts partway up the accent. That is the right reading: a
 * muscle with no minimum effective volume is growing from its first direct set.
 */
function stops(l: VolumeLandmarks, colors: Palette): { at: number; color: string }[] {
  return [
    { at: 0, color: colors.surfaceMuted },
    { at: l.mv, color: mix(colors.surfaceMuted, colors.accent, 0.35) },
    { at: l.mev, color: mix(colors.surfaceMuted, colors.accent, 0.7) },
    { at: l.mav, color: colors.accent },
    { at: l.mrv, color: colors.warning },
    { at: l.mrv + 12, color: colors.danger },
  ];
}

/**
 * Colour for a muscle that saw `setsPerWeek` working sets.
 *
 * Unlike a share-of-peak ramp this is absolute: a muscle is dim because it was
 * genuinely undertrained, not merely because some other muscle got more. A
 * deload week and a hard week no longer look the same.
 */
export function volumeColor(
  setsPerWeek: number,
  colors: Palette,
  landmarks: VolumeLandmarks,
): string {
  if (setsPerWeek <= 0) return colors.surfaceMuted;
  // A row with no ceiling is one of the non-muscles, and every stop below would
  // sit on zero — which would put a single logged cardio set at the far end of
  // the ramp, in the colour reserved for overreaching. Nothing is being measured
  // here, so nothing is coloured.
  if (landmarks.mrv <= 0) return colors.surfaceMuted;

  const ramp = stops(landmarks, colors);
  const last = ramp[ramp.length - 1];
  if (setsPerWeek >= last.at) return last.color;

  for (let i = 1; i < ramp.length; i++) {
    const lo = ramp[i - 1];
    const hi = ramp[i];
    if (setsPerWeek <= hi.at) {
      const span = hi.at - lo.at;
      return mix(lo.color, hi.color, span === 0 ? 1 : (setsPerWeek - lo.at) / span);
    }
  }
  return last.color;
}

/**
 * Sample points for the legend, so it ramps identically to the figures.
 *
 * Deduplicated because a row with no MV or MEV collapses those stops onto zero,
 * and the legend would otherwise draw the same swatch three times.
 */
export function legendSamples(l: VolumeLandmarks): number[] {
  return [...new Set([0, l.mv, l.mev, (l.mev + l.mav) / 2, l.mav, l.mrv, l.mrv + 12])];
}
