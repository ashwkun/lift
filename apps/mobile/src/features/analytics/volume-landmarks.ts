import { mix } from '@/theme/color';
import type { Palette } from '@/theme/tokens';

/**
 * Weekly set landmarks for a muscle, in the order they are crossed.
 *
 * These are the standard hypertrophy volume landmarks: below `mv` a muscle is
 * losing ground, `mev` is where growth starts, `mrv` is the most it can recover
 * from, and past `maxv` extra sets cost more than they return.
 */
export interface VolumeThresholds {
  /** Maintenance volume — enough to hold size, not to add it. */
  readonly mv: number;
  /** Minimum effective volume — growth starts here. */
  readonly mev: number;
  /** Maximum recoverable volume — the top of the productive range. */
  readonly mrv: number;
  /** Past this, added sets stop paying for themselves. */
  readonly maxv: number;
}

export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced';

export const VOLUME_THRESHOLDS_BY_LEVEL: Record<TrainingLevel, VolumeThresholds> = {
  beginner: { mv: 4, mev: 8, mrv: 16, maxv: 20 },
  intermediate: { mv: 6, mev: 12, mrv: 22, maxv: 28 },
  advanced: { mv: 8, mev: 15, mrv: 26, maxv: 32 },
};

export const DEFAULT_VOLUME_THRESHOLDS = VOLUME_THRESHOLDS_BY_LEVEL.intermediate;

export type VolumeZone = 'untrained' | 'maintenance' | 'growth' | 'optimal' | 'overreaching';

export const VOLUME_ZONE_LABELS: Record<VolumeZone, string> = {
  untrained: 'Untrained',
  maintenance: 'Maintenance',
  growth: 'Growing',
  optimal: 'Optimal',
  overreaching: 'Overreaching',
};

export function volumeZone(setsPerWeek: number, t: VolumeThresholds = DEFAULT_VOLUME_THRESHOLDS): VolumeZone {
  if (setsPerWeek <= 0) return 'untrained';
  if (setsPerWeek < t.mev) return 'maintenance';
  if (setsPerWeek < t.mrv) return 'growth';
  if (setsPerWeek <= t.maxv) return 'optimal';
  return 'overreaching';
}

// ---------------------------------------------------------------------------
// Colour ramp
// ---------------------------------------------------------------------------

/**
 * The ramp, anchored to the landmarks rather than to even percentage steps.
 *
 * Colour changes fastest where the boundaries actually mean something, so two
 * muscles that sit either side of `mev` look different even when their set
 * counts are close. Past `maxv` the ramp leaves the accent hue entirely — an
 * overreached muscle should not read as "more of a good thing", which is the
 * one thing a single-hue opacity ramp can never express.
 */
function stops(t: VolumeThresholds, colors: Palette): { at: number; color: string }[] {
  return [
    { at: 0, color: colors.surfaceMuted },
    { at: t.mv, color: mix(colors.surfaceMuted, colors.accent, 0.35) },
    { at: t.mev, color: mix(colors.surfaceMuted, colors.accent, 0.7) },
    { at: t.mrv, color: colors.accent },
    { at: t.maxv, color: colors.warning },
    { at: t.maxv + 12, color: colors.danger },
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
  t: VolumeThresholds = DEFAULT_VOLUME_THRESHOLDS,
): string {
  if (setsPerWeek <= 0) return colors.surfaceMuted;

  const ramp = stops(t, colors);
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

/** Sample points for the legend, so it ramps identically to the figures. */
export function legendSamples(t: VolumeThresholds = DEFAULT_VOLUME_THRESHOLDS): number[] {
  return [0, t.mv, t.mev, (t.mev + t.mrv) / 2, t.mrv, t.maxv, t.maxv + 12];
}
