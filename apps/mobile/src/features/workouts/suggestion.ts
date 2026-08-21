/**
 * The wiring between one exercise on the logging screen and the progression
 * engine, which is deliberately ignorant of both.
 *
 * `suggestProgression` is pure, unit-agnostic and takes a fully resolved
 * config: a rep range, a load step, a tracking type. It does not know what a
 * barbell is, that this session was started from a routine, or that anything on
 * the other side of it is stored in SQLite. Somebody has to answer those three
 * questions before it can be called, and this is that somebody — the whole of
 * the app's policy about progression lives in the twenty lines below, where it
 * can be read at once, rather than being spread through the engine or restated
 * by every screen that wants a suggestion.
 *
 * What it emphatically does not do is *write* anything. A suggestion is a
 * proposal about a set that has not happened yet; it reaches a row only when
 * the user taps the line that states it (`ExerciseBlock`). Nothing here touches
 * the Previous column, the field placeholders or `ghostFill`, which between
 * them decide what a bare check-off commits — those are a record of what was
 * lifted, and a proposal quietly filed among them would be a lift that never
 * happened. See the header of `previous.ts`.
 */

import {
  defaultIncrementKg,
  inferRepRange,
  suggestProgression,
  type ExerciseSession,
  type Suggestion,
} from '@lift/shared';

import type { WorkoutExerciseDetail } from './repository';

export interface ProgressionInput {
  /**
   * This exercise's last few sessions, newest first — `PreviousPerformance.sessions`.
   */
  sessions: readonly ExerciseSession[];
  /**
   * The reps this session's routine prescribes for the exercise, when it was
   * started from one and the routine says.
   *
   * A prescription outranks anything inferred from history: a routine asking
   * for sets of five is not asking to be walked up to twelve because the last
   * three sessions happened to be a back-off block. Absent, the range comes
   * from what the user has actually been doing.
   */
  targetReps?: number | null;
}

/**
 * What to put in front of this exercise next, or nothing.
 *
 * Null covers every reason there is nothing to say — no history, a tracking
 * type the engine has no opinion about, or the engine declining to move — and
 * they are deliberately one answer rather than four, because the screen does
 * the same thing with all of them: renders no line at all.
 */
export function suggestForExercise(
  detail: WorkoutExerciseDetail,
  { sessions, targetReps }: ProgressionInput,
): Suggestion | null {
  if (sessions.length === 0) return null;

  /*
   * The engine runs inside a render, so a throw from it takes the logging
   * screen down mid-session rather than degrading a hint.
   *
   * That is not a hypothetical while `progression.ts` is being written — its
   * bodies throw until it lands — but the guard is not there for that. It is
   * there because this is the one opinionated corner of an app whose whole job
   * is to still be holding your sets when something goes wrong, and a bad
   * rounding on an exercise with one strange session in its history is not
   * worth the screen. A suggestion that cannot be computed is a suggestion that
   * is not offered.
   */
  try {
    // A prescription is a single number, and it becomes a band of one: clear it
    // on every set and the load goes up, which is what a routine that says "3×5"
    // means. `inferRepRange` is the fallback and reads the real range back out
    // of what was performed.
    const range =
      targetReps != null && targetReps > 0
        ? { minReps: targetReps, maxReps: targetReps }
        : inferRepRange(sessions);

    return suggestProgression(sessions, {
      trackingType: detail.exercise.trackingType,
      ...range,
      // The smallest step this equipment has. A default about equipment, not a
      // claim about the user's gym — and the number stays theirs to overwrite
      // by typing, because the suggestion only ever lands in a field they tap
      // it into.
      incrementKg: defaultIncrementKg(detail.exercise.equipment),
    });
  } catch {
    return null;
  }
}
