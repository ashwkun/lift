/**
 * What to lift next — double progression over the last few sessions.
 *
 * This is the one piece of the app that has an opinion. Everything else records
 * what happened; this reads the record and says "add a rep" or "add 2.5 kg", so
 * the number the user is walking to the rack with is arrived at by the app
 * rather than by arithmetic done between sets.
 *
 * Deliberately *not* a program: it has no notion of a week, a block, a deload
 * or a target set count. It answers one question about one exercise from that
 * exercise's own history, which is the only question a tracker is entitled to
 * answer without being asked.
 *
 * Pure and unit-agnostic, kilograms in and kilograms out, so the same function
 * can run inside the logging screen's render and inside a test with no
 * database anywhere.
 */

import {
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
  isWorkingSet,
  type Equipment,
  type SetType,
  type TrackingType,
} from './types.ts';
import { roundToIncrement } from './units.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The minimum shape the engine needs — satisfied by DB rows and drafts alike. */
export interface PerformedSet {
  weightKg: number | null;
  reps: number | null;
  setType: SetType;
  isCompleted: boolean;
}

/** One past session of a single exercise. */
export interface ExerciseSession {
  /** Epoch milliseconds. Only used to keep sessions in order. */
  startedAt: number;
  sets: readonly PerformedSet[];
}

export interface ProgressionConfig {
  trackingType: TrackingType;
  /**
   * The rep range the user is working in. Progression runs *within* this band
   * and only adds load at the top of it — the whole of double progression.
   */
  minReps: number;
  maxReps: number;
  /**
   * The smallest load step that exists on this equipment, in kilograms. A
   * suggestion is always rounded to a multiple of it: 82.4 kg is not a weight
   * anyone can load, and offering it once costs more trust than the precision
   * was ever worth.
   */
  incrementKg: number;
  /**
   * Consecutive sessions failing to beat the one before, before the engine
   * stops asking for more and takes some load off instead.
   */
  stallSessions?: number;
  /** How much load a back-off keeps, as a fraction. 0.9 means "drop 10%". */
  backOffFraction?: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type SuggestionKind =
  /** Same load, one more rep — the normal week. */
  | 'add_reps'
  /** Top of the rep range cleared on every set: load goes up, reps reset. */
  | 'add_weight'
  /** Repeat last session. Mid-range, or not enough agreement to move. */
  | 'hold'
  /** Stalled for `stallSessions`. Take load off and climb back through it. */
  | 'back_off';

/** What to put in front of one working set. */
export interface SetSuggestion {
  /** 1-based ordinal among working sets, matching the logging screen's column. */
  workingIndex: number;
  weightKg: number | null;
  reps: number | null;
}

export interface Suggestion {
  kind: SuggestionKind;
  /**
   * One short sentence, sentence case, no trailing period — it is rendered as
   * a single quiet line under an exercise heading, not as prose. "Cleared 12
   * reps last time" rather than "You have successfully completed...".
   */
  reason: string;
  /** One entry per working set the last session held, in order. */
  sets: SetSuggestion[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * A zero here is not "unknown", it is "this exercise has no load to step".
 * Push-ups and a rubber band progress by reps or by nothing; the engine reads
 * the zero as an instruction to leave the weight alone rather than as a step of
 * no size, which would otherwise suggest the same weight forever.
 */
const INCREMENT_KG: Record<Equipment, number> = {
  barbell: 2.5, // a pair of 1.25s, the smallest thing most racks own
  dumbbell: 2, // fixed racks step in 2s either side of the light end
  kettlebell: 4, // the pood-derived ladder: 8, 12, 16, 20
  machine: 5, // one pin down the stack, and often nothing finer
  cable: 2.5,
  smith_machine: 2.5,
  plate: 2.5,
  resistance_band: 0, // the next band is a different exercise, not a step
  suspension: 0, // load is body angle, which nobody logs in kilograms
  medicine_ball: 1,
  bodyweight: 0,
  cardio_machine: 0,
  other: 2.5,
};

/**
 * The smallest honest load step for a piece of equipment, in kilograms.
 *
 * A barbell moves in 2.5 kg because that is a pair of 1.25s; a dumbbell rack
 * usually steps in 2; a stack machine in 5 and sometimes nothing smaller. These
 * are defaults for a suggestion, not claims about the user's gym — the number
 * is always theirs to overwrite by typing.
 */
export function defaultIncrementKg(equipment: Equipment): number {
  return INCREMENT_KG[equipment] ?? 2.5;
}

/** The band to fall back on when the history says nothing usable. */
const DEFAULT_MIN_REPS = 8;
const DEFAULT_MAX_REPS = 12;

/**
 * A band narrower than two reps is a target, not a range — there is nowhere to
 * progress *within* it, so double progression degenerates into adding weight
 * every session. Wider than eight and the top of it is a different exercise
 * from the bottom: an AMRAP set of 25 shouldn't drag a lifter's 5s up with it.
 */
const MIN_BAND_WIDTH = 2;
const MAX_BAND_WIDTH = 8;

/**
 * The rep range to work in when nothing else says otherwise.
 *
 * Taken from what the sessions actually did rather than from a fixed 8–12: a
 * lifter doing sets of 5 is not asking to be walked up to 12. The low end is
 * theirs untouched — it is the rep count they choose their weights for — and
 * only the top is clamped, since that is where the outliers live.
 */
export function inferRepRange(sessions: readonly ExerciseSession[]): {
  minReps: number;
  maxReps: number;
} {
  let lowest = Infinity;
  let highest = 0;

  for (const session of sessions) {
    for (const set of session.sets) {
      const reps = usableReps(set);
      if (reps === null) continue;
      lowest = Math.min(lowest, reps);
      highest = Math.max(highest, reps);
    }
  }

  if (!Number.isFinite(lowest) || highest < 1) {
    return { minReps: DEFAULT_MIN_REPS, maxReps: DEFAULT_MAX_REPS };
  }

  const minReps = Math.max(1, lowest);
  const maxReps = Math.min(
    Math.max(highest, minReps + MIN_BAND_WIDTH),
    minReps + MAX_BAND_WIDTH,
  );
  return { minReps, maxReps };
}

// ---------------------------------------------------------------------------
// Reading the history
// ---------------------------------------------------------------------------

/**
 * The tracking types this engine declines to answer for.
 *
 * A run's progression is not a rep and a weight — pace, distance and duration
 * trade against each other in ways a set-and-rep rule cannot speak to, and on a
 * screen where every other line is a fact, a confident wrong answer costs more
 * than a blank space.
 */
const UNOPINIONATED_TRACKING: ReadonlySet<TrackingType> = new Set<TrackingType>([
  'duration',
  'distance_duration',
  'weight_distance',
]);

const DEFAULT_STALL_SESSIONS = 3;
const DEFAULT_BACK_OFF_FRACTION = 0.9;

/** Loads are user-typed decimals; compare them with a hair of room. */
const EPSILON = 1e-9;

/** One completed working set, reduced to the two numbers the engine reasons about. */
interface ReadSet {
  workingIndex: number;
  /** Null when the exercise carries no load, or none was ever recorded. */
  loadKg: number | null;
  reps: number;
}

/**
 * The rep count worth reading off a set: completed, working, and an actual
 * number. A warm-up ramp or a set the user never checked says nothing about
 * whether the range was cleared, and a null rep count is not a zero.
 */
function usableReps(set: PerformedSet): number | null {
  if (!set.isCompleted || !isWorkingSet(set.setType)) return null;
  if (set.reps === null || !Number.isFinite(set.reps) || set.reps < 1) return null;
  // Reps are whole in the schema; rounding keeps a stray float from coming back
  // out of the engine as "8.5 reps".
  return Math.round(set.reps);
}

/**
 * The load a set was performed at, or null when there isn't one to speak of.
 *
 * An empty weight box means two different things and the tracking type is what
 * tells them apart: on the bodyweight variants it is itself a fact — no belt,
 * no assistance — while on a barbell lift it is a number nobody wrote down, and
 * "2.5 kg" as the next step up from a load we never knew is worse than silence.
 * The logging screen's `ghostFill` draws the same line for the same reason.
 */
function readLoad(set: PerformedSet, trackingType: TrackingType): number | null {
  if (!TRACKING_FIELDS[trackingType].weight) return null;
  if (set.weightKg === null || !Number.isFinite(set.weightKg)) {
    return USES_BODYWEIGHT.has(trackingType) ? 0 : null;
  }
  return set.weightKg;
}

/**
 * A session reduced to its completed working sets, numbered the way the logging
 * screen numbers them.
 *
 * Warm-ups don't consume a working-set ordinal, so the number is counted here
 * rather than taken from the array index — the same walk `pairWithPrevious`
 * does when it lines today's sets up against last session's. Pairing by raw
 * position instead would compare this week's first working set against last
 * week's second warm-up the moment the two sessions disagree about the ramp.
 */
function readSets(session: ExerciseSession, trackingType: TrackingType): ReadSet[] {
  const sets: ReadSet[] = [];

  for (const set of session.sets) {
    const reps = usableReps(set);
    if (reps === null) continue;
    sets.push({
      workingIndex: sets.length + 1,
      loadKg: readLoad(set, trackingType),
      reps,
    });
  }

  return sets;
}

/**
 * Did this set improve on the one that held its ordinal last time? More load,
 * or the same load for more reps.
 *
 * Signed, because on assisted work the entered number is help rather than load:
 * 40 kg of assistance beats 45 kg of it, and a comparison that missed that would
 * read a lifter's best month as a stall.
 */
function setImproved(set: ReadSet, previous: ReadSet, sign: number): boolean {
  const load = sign * (set.loadKg ?? 0);
  const previousLoad = sign * (previous.loadKg ?? 0);

  if (load > previousLoad + EPSILON) return true;
  if (load < previousLoad - EPSILON) return false;
  return set.reps > previous.reps;
}

/**
 * Did this session beat the one before it? Any one set improving is enough.
 *
 * Compared set against set, by the ordinal the logging screen numbers them by,
 * rather than by the session's heaviest set alone. A top-set comparison only
 * ever sees the first number of a descending run: 100/95/90 becoming
 * 100/97.5/95 is two sets better and one set the same, and reading only the top
 * of it reports no progress at all. Three of those in a row and the app takes
 * 10% off a lifter who has been improving the whole time — the one failure this
 * function has that costs real weight.
 *
 * "Any set improved" rather than "no set got worse": a stall is nothing moving
 * anywhere, and a session that went up on two sets and down on one is a lot of
 * things, but it is not stuck.
 */
function beatsPrevious(
  session: readonly ReadSet[],
  previous: readonly ReadSet[],
  sign: number,
): boolean {
  // An added working set is more work than last time, whatever is written on it.
  if (session.length > previous.length) return true;

  const byIndex = new Map(previous.map((set) => [set.workingIndex, set]));

  return session.some((set) => {
    const before = byIndex.get(set.workingIndex);
    return before !== undefined && setImproved(set, before, sign);
  });
}

/**
 * `stallSessions` sessions in a row with nothing to show for each other.
 *
 * Read across the window rather than against a session before it: "same weight
 * for three sessions" is what a stall looks like to the person living it, and
 * requiring a fourth session as a baseline would delay the back-off past the
 * point where it helps. Short history is never a stall — two sessions at the
 * same weight is a normal week, and taking 10% off it would be the app
 * inventing a problem.
 */
function isStalled(history: readonly ReadSet[][], stallSessions: number, sign: number): boolean {
  if (history.length < stallSessions) return false;

  for (let index = 0; index + 1 < stallSessions; index++) {
    if (beatsPrevious(history[index]!, history[index + 1]!, sign)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** One increment in the direction that makes the exercise harder. */
function stepLoad(loadKg: number, incrementKg: number, sign: number): number {
  return Math.max(0, roundToIncrement(loadKg + sign * incrementKg, incrementKg));
}

/**
 * The load to climb back through after a stall.
 *
 * Rounded to the increment, because the point of a back-off is a weight that
 * can be loaded. When the rounding lands back on the weight that caused the
 * stall — a 10% cut of a 10 kg stack is one whole increment short of moving the
 * pin — it steps by a single increment instead, so the suggestion is always
 * different from what the user just failed at.
 */
function backOffLoad(
  loadKg: number,
  incrementKg: number,
  backOffFraction: number,
  sign: number,
): number {
  if (sign < 0) {
    // Assistance: backing off means *more* help, by the same fraction.
    const eased = roundToIncrement(loadKg * (2 - backOffFraction), incrementKg);
    return eased > loadKg + EPSILON ? eased : loadKg + incrementKg;
  }

  const eased = Math.max(0, roundToIncrement(loadKg * backOffFraction, incrementKg));
  return eased < loadKg - EPSILON ? eased : Math.max(0, loadKg - incrementKg);
}

/**
 * What to do next, from the sessions that came before.
 *
 * `sessions` is newest-first and may be empty. Returns null when there is
 * nothing worth saying: no history at all, or a tracking type this engine has
 * no opinion about (a run's progression is not a rep and a weight).
 */
export function suggestProgression(
  sessions: readonly ExerciseSession[],
  config: ProgressionConfig,
): Suggestion | null {
  const { trackingType } = config;
  if (UNOPINIONATED_TRACKING.has(trackingType)) return null;

  // Sorted rather than trusted. `sessions` is documented newest-first, but a
  // caller who hands them over the other way round would be told that every
  // session in the file was a stall, which is the one answer here that loses a
  // user weight they had already earned.
  const history = [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((session) => readSets(session, trackingType))
    .filter((sets) => sets.length > 0);

  if (history.length === 0) return null;
  const last = history[0]!;

  // None of the config is trusted either: these numbers land in a weight field.
  const minReps = Math.max(1, Math.round(finiteOr(config.minReps, DEFAULT_MIN_REPS)));
  const maxReps = Math.max(minReps, Math.round(finiteOr(config.maxReps, DEFAULT_MAX_REPS)));
  const incrementKg = Math.max(0, finiteOr(config.incrementKg, 0));
  const stallSessions = Math.max(
    2,
    Math.round(finiteOr(config.stallSessions, DEFAULT_STALL_SESSIONS)),
  );
  const requested = finiteOr(config.backOffFraction, DEFAULT_BACK_OFF_FRACTION);
  const backOffFraction =
    requested > 0 && requested < 1 ? requested : DEFAULT_BACK_OFF_FRACTION;

  // Assistance is the one number in the app that runs backwards: 40 kg of help
  // is harder work than 45. Both the comparison and the step carry the sign, or
  // the engine would congratulate a lifter for needing more help and then
  // prescribe more of it — an exercise made easier every week, forever.
  const sign = trackingType === 'assisted_bodyweight' ? -1 : 1;

  // A load steps only when there is a step to take and a number to take it
  // from. Push-ups have neither, and a barbell set logged without a weight has
  // no load we are entitled to add to; both fall back to progressing on reps.
  const canStepLoad = incrementKg > 0 && last.every((set) => set.loadKg !== null);

  const clearedTop = last.every((set) => set.reps >= maxReps);
  // A set under the band is not asked for another rep. The load is already too
  // heavy for the range it is meant to be worked in, and the way out is to
  // repeat it until it isn't.
  const canTakeRep = (set: ReadSet): boolean =>
    set.reps >= minReps && (set.reps < maxReps || !canStepLoad);

  // The whole of double progression, and the reason `kind` is one word for the
  // exercise rather than one per set: the weight goes up only when *every* set
  // cleared the top. Bumping it because set one was good and set four was not
  // is how a lifter spends a month failing the same session.
  //
  // Both ways forward are settled before the stall check, and for the same
  // reason. Three sessions at the top of the range read as a stall by the letter
  // of the rule, and so do three sessions parked mid-band — but neither lifter
  // is stuck. One has been waiting for the weight to go up; the other has room
  // to add a rep and was simply never asked, which is true of *everyone* the
  // first time this feature speaks to them. Taking 10% off someone who has never
  // been given a target to miss is the worst thing this engine can do, and
  // checking the stall first did exactly that.
  //
  // What is left when both are ruled out is the honest definition of stuck: no
  // weight to add because the top of the range was not cleared, and no rep to
  // add because the sets are coming in under the bottom of it. Three sessions of
  // that is a stall.
  let kind: SuggestionKind;
  if (clearedTop && canStepLoad) kind = 'add_weight';
  else if (last.some(canTakeRep)) kind = 'add_reps';
  else if (canStepLoad && isStalled(history, stallSessions, sign)) kind = 'back_off';
  else kind = 'hold';

  const suggestedSets: SetSuggestion[] = last.map((set) => {
    switch (kind) {
      case 'add_weight':
        return {
          workingIndex: set.workingIndex,
          weightKg: stepLoad(set.loadKg ?? 0, incrementKg, sign),
          reps: minReps,
        };

      case 'back_off':
        return {
          workingIndex: set.workingIndex,
          weightKg: backOffLoad(set.loadKg ?? 0, incrementKg, backOffFraction, sign),
          reps: minReps,
        };

      case 'add_reps':
        return {
          workingIndex: set.workingIndex,
          weightKg: set.loadKg,
          reps: canTakeRep(set) ? set.reps + 1 : set.reps,
        };

      case 'hold':
        return { workingIndex: set.workingIndex, weightKg: set.loadKg, reps: set.reps };
    }
  });

  return {
    kind,
    reason: writeReason(kind, {
      last,
      minReps,
      maxReps,
      stallSessions,
      backOffFraction,
      sign,
    }),
    sets: suggestedSets,
  };
}

// ---------------------------------------------------------------------------
// The one line of justification
// ---------------------------------------------------------------------------

interface ReasonContext {
  last: readonly ReadSet[];
  minReps: number;
  maxReps: number;
  stallSessions: number;
  backOffFraction: number;
  sign: number;
}

/**
 * The sentence under the heading.
 *
 * This line is the entire justification the user gets for a number the app is
 * asking them to lift, so it says *why* rather than restating the suggestion:
 * "Two reps off the top of the range", not "Add a rep". Sentence case and no
 * full stop, because it is a caption, not prose.
 */
function writeReason(kind: SuggestionKind, ctx: ReasonContext): string {
  const { last, minReps, maxReps, stallSessions, backOffFraction, sign } = ctx;

  switch (kind) {
    case 'add_weight':
      return sign < 0
        ? `Cleared ${maxReps} reps on every set — less help next time`
        : `Cleared ${maxReps} reps on every set`;

    case 'back_off': {
      const percent = Math.round((1 - backOffFraction) * 100);
      const under = last.filter((set) => set.reps < minReps).length;
      // A back-off is only reachable once both ways forward are ruled out, so
      // the line names the miss rather than the flatness. "Same weight for three
      // sessions" described a lifter who might simply have been coasting; this
      // one has been failing the reps they set out to do, which is the fact that
      // justifies taking weight off the bar.
      const opening =
        under === last.length
          ? `Short of ${minReps} reps for ${countWord(stallSessions)} sessions`
          : `${capitalize(countWord(under))} of ${countWord(last.length)} sets short for ${countWord(stallSessions)} sessions`;
      return sign < 0
        ? `${opening} — add ${percent}% more help`
        : `${opening} — take ${percent}% off`;
    }

    case 'add_reps': {
      const cleared = last.filter((set) => set.reps >= maxReps).length;
      if (cleared === last.length) return `No load to add — climb past ${maxReps} reps instead`;
      if (cleared > 0) {
        const count = `${capitalize(countWord(cleared))} of ${countWord(last.length)}`;
        return `${count} sets cleared ${maxReps}`;
      }
      const gap = maxReps - Math.min(...last.map((set) => set.reps));
      return `${capitalize(countWord(gap))} ${gap === 1 ? 'rep' : 'reps'} off the top of the range`;
    }

    case 'hold': {
      const under = last.filter((set) => set.reps < minReps).length;
      if (under === last.length) return `Short of ${minReps} reps — repeat this weight`;
      const count = `${capitalize(countWord(under))} of ${countWord(last.length)}`;
      return `${count} sets fell short of ${minReps}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Small counts read better spelled out; rep targets stay as numerals. */
function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
