/**
 * Named sessions that can become routines.
 *
 * A CSV has no routine table. What it has is a title repeated on every set of
 * a session, which in Hevy, Strong, Lyfta and Lift is the name of the programme
 * the session was started from. Grouping on that title, taking the most recent
 * session of each, is the closest thing to "the routine they currently run"
 * the file can give us.
 *
 * This is vendor-blind: it reads `ImportedWorkout[]` after parse, and does not
 * care which app wrote the file. Untitled sessions are skipped. The importer
 * invents a date-based name for those when it writes them, and a routine called
 * "Wednesday workout" is not something anyone asked to save.
 *
 * Names match case-insensitively, but the spelling on the latest session is
 * the one that is kept: "push day" in 2024 and "Push Day" last week is one
 * routine, named as they named it last.
 *
 * A name that appears once is still a routine. One cycle of a four-day split
 * is four titles with one session each, and requiring a repeat would drop the
 * whole programme.
 */

import type { ImportedWorkout } from './parse.ts';

export interface IdentifiedRoutine {
  /** Display name as the latest session spelled it. */
  name: string;
  /** Lower-cased, trimmed. Stable across rename in the UI. */
  key: string;
  /** How many sessions in the window used this name. */
  sessionCount: number;
  /** The most recent session — the template. */
  latest: ImportedWorkout;
}

export function identifyRoutines(
  workouts: readonly ImportedWorkout[],
): IdentifiedRoutine[] {
  const groups = new Map<string, ImportedWorkout[]>();

  for (const workout of workouts) {
    const name = workout.name.trim();
    if (!name) continue;
    if (workout.exercises.length === 0) continue;

    const key = name.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(workout);
    else groups.set(key, [workout]);
  }

  const identified: IdentifiedRoutine[] = [];

  for (const [key, sessions] of groups) {
    let latest = sessions[0]!;
    for (const session of sessions) {
      if (session.startedAt >= latest.startedAt) latest = session;
    }

    identified.push({
      name: latest.name.trim(),
      key,
      sessionCount: sessions.length,
      latest,
    });
  }

  // Map insertion order is first-seen. The parser returns workouts oldest
  // first, so that is programme order for a split logged in sequence.
  return identified;
}
