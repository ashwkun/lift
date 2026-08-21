/**
 * Weekly set landmarks, per muscle.
 *
 * These are the hypertrophy volume landmarks popularised by Renaissance
 * Periodization: below MV a muscle is losing ground, MEV is where growth
 * starts, MAV is the band it grows fastest in, and MRV is the most it can
 * recover from. The statistics screens colour a muscle by where its week fell
 * against them.
 *
 * They are per *muscle* rather than one table for the whole body, which is the
 * only way they mean anything: side delts tolerate roughly half again what
 * triceps do, and a single pair of thresholds applied to both calls one of them
 * wrong every week.
 *
 * Two honest caveats, because these numbers get quoted as if they were
 * measured. They are informed estimates rather than findings — the evidence
 * for any *specific* per-muscle threshold is thin, and the spread between two
 * lifters is wider than the spread between two muscles here. They are defaults
 * for a colour ramp, not a prescription.
 */

import type { MuscleGroup } from './types.ts';

/** Weekly working sets, in the order they are crossed. */
export interface VolumeLandmarks {
  /** Maintenance volume — enough to hold size, not to add it. */
  readonly mv: number;
  /** Minimum effective volume — growth starts here. */
  readonly mev: number;
  /** Maximum adaptive volume — the top of the band that grows fastest. */
  readonly mav: number;
  /** Maximum recoverable volume — past this, fatigue outruns recovery. */
  readonly mrv: number;
}

export const TRAINING_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type TrainingLevel = (typeof TRAINING_LEVELS)[number];

export const TRAINING_LEVEL_LABELS: Record<TrainingLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const DEFAULT_TRAINING_LEVEL: TrainingLevel = 'intermediate';

/**
 * The landmarks for an intermediate lifter, per muscle.
 *
 * Other levels are derived from these rather than tabulated separately — see
 * `landmarksFor`. Three hand-maintained tables would drift apart, and the
 * difference between a beginner and an advanced lifter is much better described
 * as "the same shape, scaled" than as sixty independent numbers.
 *
 * The published figures are per *training* muscle — chest, back, side delts,
 * rear delts, quads, hamstrings, biceps, triceps, glutes, calves, abs, traps.
 * Lift's `MuscleGroup` is finer in places and coarser in others, so several rows
 * here are a judgement rather than a quotation. Each of those says which way it
 * was bent and why.
 */
export const LANDMARKS_BY_MUSCLE: Record<MuscleGroup, VolumeLandmarks> = {
  chest: { mv: 8, mev: 10, mav: 20, mrv: 22 },

  // The published back row (8/10/22/25) covers everything between the neck and
  // the hips as one muscle. Lift logs lats and upper back separately, so the row
  // is split rather than repeated: neither half alone tolerates the whole back's
  // volume, and giving both the full row would call 25 lat sets *plus* 25 rowing
  // sets a perfect week. The halves overlap deliberately — a row trains both and
  // is credited to both — so they sum to more than the original row.
  lats: { mv: 6, mev: 10, mav: 18, mrv: 22 },
  // The smaller half: less of a typical week's pulling is horizontal, and what
  // is often gets logged against lats or traps instead.
  upper_back: { mv: 4, mev: 8, mav: 16, mrv: 20 },
  // Erectors are not in the published table at all. They take a large indirect
  // load from every squat, deadlift and row, which is why MV is zero — almost
  // nobody needs direct work to hold them — and they carry systemic fatigue, so
  // the ceiling is the lowest on the board.
  lower_back: { mv: 0, mev: 4, mav: 10, mrv: 14 },
  // The published traps row, kept as published. It already assumes the mid and
  // lower traps get their work from rowing (hence MV and MEV of zero); what is
  // left is direct shrug and carry volume, which the upper traps tolerate a lot
  // of.
  traps: { mv: 0, mev: 0, mav: 20, mrv: 26 },

  // One `shoulders` group collects presses, laterals and rear flyes, so it
  // cannot simply inherit the side-delt row (6/8/22/26) — it is counting two
  // heads' sets against one head's ceiling. Nor can it be the sum of side and
  // rear (which would put MAV at 40): the heads recover independently, but no
  // real lifter splits them evenly, and a sum would let 30 sets of laterals pass
  // as a comfortable week. It sits between: about half again the side-delt row.
  // Front delts are left out of the arithmetic on purpose, since they are fed by
  // horizontal pressing that is already logged against chest.
  shoulders: { mv: 6, mev: 10, mav: 24, mrv: 30 },

  biceps: { mv: 4, mev: 6, mav: 20, mrv: 26 },
  triceps: { mv: 4, mev: 6, mav: 14, mrv: 18 },
  // Not in the published table. Grip is loaded by every pull, row and carry a
  // lifter already does, so no direct work is needed to hold or even to build
  // forearms — the same argument that gives glutes and abs a zero MEV. They
  // recover quickly, so the ceiling is generous.
  forearms: { mv: 0, mev: 0, mav: 16, mrv: 20 },

  abs: { mv: 0, mev: 0, mav: 16, mrv: 20 },
  // Obliques share the abs' argument for a zero floor — every braced squat and
  // carry trains them — with a lower ceiling, because they are the smaller part
  // of the core and most direct core work is credited to abs.
  obliques: { mv: 0, mev: 0, mav: 12, mrv: 16 },

  quads: { mv: 6, mev: 8, mav: 18, mrv: 20 },
  hamstrings: { mv: 4, mev: 6, mav: 16, mrv: 20 },
  glutes: { mv: 0, mev: 0, mav: 12, mrv: 16 },
  calves: { mv: 4, mev: 6, mav: 16, mrv: 20 },
  // Adductors are a large mass fed by every squat, lunge and split stance, so
  // the floor is zero. The ceiling is held below the hamstring row because
  // direct adduction is the one movement here with a real strain risk when it is
  // pushed.
  adductors: { mv: 0, mev: 0, mav: 14, mrv: 18 },
  // Abductors get theirs from the same hip work as glutes, and are smaller —
  // the glute row, which is already a zero-floor row for the same reason.
  abductors: { mv: 0, mev: 0, mav: 12, mrv: 16 },
  // Rarely trained directly and quick to recover, but the loaded range is short
  // and the tissue is unforgiving, so the productive band is narrow and low.
  neck: { mv: 0, mev: 0, mav: 10, mrv: 14 },

  // Not muscles. These three are buckets a set can land in — a run, a session
  // tagged whole-body, an exercise nobody classified — and no number of them is
  // enough or too many.
  //
  // A zero row is the honest entry: it makes no claim at all. It does mean the
  // row has no scale, which the callers have to notice rather than divide by, so
  // `volumeZone` reads a zero ceiling as "no claim" and the colour ramp leaves
  // these flat. The alternative — real-looking thresholds — would have the
  // statistics screens telling someone their cardio is past its MRV.
  cardio: { mv: 0, mev: 0, mav: 0, mrv: 0 },
  full_body: { mv: 0, mev: 0, mav: 0, mrv: 0 },
  other: { mv: 0, mev: 0, mav: 0, mrv: 0 },
};

/**
 * What a training level does to the intermediate row.
 *
 * One factor for the whole row rather than one per landmark: training age moves
 * every landmark the same way — a beginner grows on less *and* recovers from
 * less — and per-field factors would be eight more hand-tuned numbers, which is
 * the drift a single table exists to avoid.
 */
const LEVEL_FACTORS: Record<TrainingLevel, number> = {
  beginner: 0.7,
  intermediate: 1,
  advanced: 1.2,
};

/**
 * Scales one landmark and rounds it back to whole sets.
 *
 * Zero survives scaling: a muscle that needs no maintenance work does not
 * acquire a maintenance requirement by its owner getting stronger.
 *
 * Everything else has to *move*, hence the clamps. Rounding alone leaves small
 * landmarks where they were — 1.2 × 2 sets rounds back to 2 — which would let a
 * level change do nothing at all to half a row.
 */
function scaleLandmark(value: number, factor: number): number {
  if (value <= 0) return 0;
  if (factor === 1) return value;

  const scaled = Math.round(value * factor);
  // Never below one set: the row is in whole sets, so that is as far down as
  // "some" goes before it becomes "none", which would be a different claim.
  if (factor < 1) return Math.max(1, Math.min(scaled, value - 1));
  return Math.max(scaled, value + 1);
}

/** The landmarks a muscle is judged against at a given training level. */
export function landmarksFor(
  muscle: MuscleGroup,
  level: TrainingLevel = DEFAULT_TRAINING_LEVEL,
): VolumeLandmarks {
  const base = LANDMARKS_BY_MUSCLE[muscle];
  const factor = LEVEL_FACTORS[level];
  if (factor === 1) return base;

  // Each landmark is floored at the one below it. Scaling by a single factor and
  // rounding cannot actually invert the order, but the invariant callers rely on
  // — mv <= mev <= mav <= mrv, which the colour ramp reads as a sequence of
  // stops — is worth holding structurally rather than as a property of whichever
  // factors happen to be in the table above.
  const mv = scaleLandmark(base.mv, factor);
  const mev = Math.max(mv, scaleLandmark(base.mev, factor));
  const mav = Math.max(mev, scaleLandmark(base.mav, factor));
  const mrv = Math.max(mav, scaleLandmark(base.mrv, factor));

  return { mv, mev, mav, mrv };
}

export const VOLUME_ZONES = [
  'untrained',
  'maintenance',
  'growth',
  'optimal',
  'overreaching',
] as const;
export type VolumeZone = (typeof VOLUME_ZONES)[number];

export const VOLUME_ZONE_LABELS: Record<VolumeZone, string> = {
  untrained: 'Untrained',
  maintenance: 'Maintenance',
  growth: 'Growing',
  optimal: 'Optimal',
  overreaching: 'Overreaching',
};

/** Which zone a week's set count falls in, for one muscle's landmarks. */
export function volumeZone(setsPerWeek: number, landmarks: VolumeLandmarks): VolumeZone {
  if (setsPerWeek <= 0) return 'untrained';

  // A row with no ceiling is one of the non-muscles, and every comparison below
  // would be false for it — dropping a logged set out of the top of the row and
  // reporting it as overreaching, the one reading that is actively wrong. Sets
  // were done and nothing is being claimed about growth, which is what the
  // bottom zone already means.
  if (landmarks.mrv <= 0) return 'maintenance';

  if (setsPerWeek < landmarks.mev) return 'maintenance';
  if (setsPerWeek < landmarks.mav) return 'growth';
  if (setsPerWeek <= landmarks.mrv) return 'optimal';
  return 'overreaching';
}
