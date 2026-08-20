/**
 * Motion tokens.
 *
 * Same reasoning as `spacing` and `radius`: durations picked per call site
 * drift, and drifting durations are how an interface starts feeling assembled
 * rather than designed. Four durations, three easings, two springs — every
 * animation in the app is built from these.
 *
 * The numbers are short on purpose. Motion here is feedback, not decoration:
 * it exists to say "that press registered" or "this number just changed", and
 * anything a user has to *wait* for has stopped being feedback. Nothing outside
 * a full-screen transition should run longer than `base`.
 *
 * Every config carries `ReduceMotion.System`, so the OS accessibility setting
 * is honoured on the UI thread without a JS round trip to observe it. Reanimated
 * then jumps straight to the target value: the state change still happens and
 * still reads, it just doesn't travel. Use `useReduceMotion` only when the
 * *content* has to change too (skipping confetti entirely, say) — for anything
 * built from these configs it is already handled.
 */

import { Easing, ReduceMotion } from 'react-native-reanimated';

export const duration = {
  /** Press feedback. Below this a state change reads as a glitch, above it as lag. */
  instant: 90,
  /** The default: a control flipping state, a row arriving, a colour crossfade. */
  fast: 140,
  /** Content landing after a query, a thumb crossing its track. */
  base: 200,
  /** Only for something travelling the width or height of the screen. */
  slow: 280,
} as const;

export const easing = {
  /** Entrances and anything the user just caused. Fast off the mark, soft landing. */
  out: Easing.out(Easing.cubic),
  /** Exits, where the eye is already leaving and the tail is wasted. */
  in: Easing.in(Easing.quad),
  /** Travel between two on-screen positions, where both ends are watched. */
  inOut: Easing.inOut(Easing.cubic),
} as const;

/**
 * Ready-made `withTiming` configs. Spread-free — pass them straight through:
 * `withTiming(1, timing.press)`.
 */
export const timing = {
  press: { duration: duration.instant, easing: easing.out, reduceMotion: ReduceMotion.System },
  /** State flips: a fill changing, a segment selecting. */
  state: { duration: duration.fast, easing: easing.out, reduceMotion: ReduceMotion.System },
  /** A value arriving or being replaced. */
  content: { duration: duration.base, easing: easing.out, reduceMotion: ReduceMotion.System },
  /** Something moving between two positions it will be watched at both ends of. */
  travel: { duration: duration.base, easing: easing.inOut, reduceMotion: ReduceMotion.System },
} as const;

export const spring = {
  /**
   * The release half of a press. Overdamped on purpose: a button that visibly
   * wobbles back to size draws attention to itself for a hundred milliseconds
   * after the user has already moved on to whatever they tapped it for.
   */
  release: { damping: 18, stiffness: 420, mass: 0.6, reduceMotion: ReduceMotion.System },
  /** Genuinely celebratory — a set completing, a record landing. Allowed to overshoot. */
  bounce: { damping: 11, stiffness: 340, mass: 0.5, reduceMotion: ReduceMotion.System },
} as const;

/**
 * How far a pressable shrinks under the thumb.
 *
 * One scale for controls that sit in the layout as objects — buttons, cards,
 * chips. Full-bleed list rows deliberately do *not* use it: a row that spans
 * the screen has its edges against the margin, so shrinking it pulls both edges
 * inward at once and reads as the row detaching from the page rather than being
 * pushed into it. Those get the fill crossfade alone.
 */
export const PRESS_SCALE = 0.97;

/** Small targets take a deeper press — 3% of a 44pt circle is not visible. */
export const PRESS_SCALE_SMALL = 0.9;

/**
 * Per-item delay when a group of elements reveals together, and the ceiling on
 * the total.
 *
 * A stagger is legible for about four steps; past that it stops reading as one
 * group arriving and starts reading as a list that is loading slowly. The cap
 * is what keeps a 60-row history list from spending three seconds appearing.
 */
export const STAGGER_STEP_MS = 40;
export const STAGGER_MAX_MS = 160;
