/**
 * The one-session rule, resolved once for every screen that starts a workout.
 *
 * `startWorkout` and `repeatWorkout` are create-only and throw
 * `ActiveWorkoutExistsError`, which leaves each caller with the same three-way
 * decision to make. Making it three times, in three files, is how the old
 * get-or-create bug survived: two of the call sites simply never looked. This
 * module owns the decision and the words it says out loud.
 */

import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { workoutExercises, workoutSets, type Workout } from '@/db/schema';
import { cancelRestNotification } from '@/features/notifications/rest';
import { showAlert, showDialog } from '@/store/dialog';
import { useTimer } from '@/store/timer';

import { ActiveWorkoutExistsError, discardWorkout } from './repository';

/**
 * What the caller should do next.
 *
 * `started` and `resumed` both mean "go to the active screen"; they are kept
 * apart so a screen can pick `push` or `replace` per case if it needs to.
 * `blocked` and `failed` mean the user has already been told, and the screen
 * should stay where it is.
 */
export type StartOutcome = 'started' | 'resumed' | 'blocked' | 'failed';

export interface StartSessionOptions {
  /** Creates the session. Must be create-only, i.e. it throws when one is open. */
  create: () => Promise<Workout>;
  /**
   * Whether an already-open session is the very thing the user just asked for.
   *
   * Tapping Start on Leg Day with Leg Day open is a resume, not a conflict, and
   * the button should have said so. Repeating a past session is never a resume,
   * so that caller leaves this out.
   */
  resumes?: (open: Workout) => boolean;
  /**
   * Runs from the blocking dialog's second button.
   *
   * Navigation is passed in rather than imported so this module stays out of
   * the router, and so each screen can choose push or replace for itself.
   */
  openExisting: () => void;
}

/**
 * Creates a session, resolving an open one first.
 *
 * Three branches, in the order a person would reason about them: this *is* the
 * session you asked for; the open one holds no work and can go; the open one
 * holds work and only you can decide what happens to it. There is deliberately
 * no one-tap "discard and start" — that button deletes sets someone performed.
 */
export async function startSession(options: StartSessionOptions): Promise<StartOutcome> {
  try {
    await options.create();
    return 'started';
  } catch (error) {
    if (error instanceof ActiveWorkoutExistsError) return resolveConflict(error.workout, options);

    void showAlert('Could not start the workout', describe(error));
    return 'failed';
  }
}

async function resolveConflict(
  open: Workout,
  { create, resumes, openExisting }: StartSessionOptions,
): Promise<StartOutcome> {
  if (resumes?.(open)) return 'resumed';

  const logged = await countCompletedSets(open.id);

  if (logged > 0) {
    // Not awaited: `blocked` is the outcome whichever button is pressed — the
    // caller's job is to stay put, and `openExisting` navigates on its own.
    void showDialog({
      title: 'A workout is in progress',
      message:
        `${open.name} has ${logged === 1 ? '1 logged set' : `${logged} logged sets`}. ` +
        'Finish or discard it before starting another.',
      actions: [
        { label: 'Cancel', style: 'cancel' },
        { label: `Open ${open.name}`, onPress: openExisting },
      ],
    });
    return 'blocked';
  }

  // Nothing was performed in it, so there is nothing to warn about and nothing
  // to ask. Clear it and carry on with what the user actually tapped.
  try {
    await discardWorkout(open.id);
    // Rest state carries no workoutId, but the session just deleted was by
    // definition the only open one, so any rest still running belonged to it —
    // left alone it counts down over the new session under the old exercise's
    // name, and its bell rings for work that no longer exists. The ongoing
    // workout notification needs nothing here: it is driven from the open
    // session by the live query at the app root.
    useTimer.getState().stopRest();
    void cancelRestNotification();
    await create();
    return 'started';
  } catch (error) {
    void showAlert('Could not start the workout', describe(error));
    return 'failed';
  }
}

async function countCompletedSets(workoutId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .where(
      and(
        eq(workoutExercises.workoutId, workoutId),
        eq(workoutSets.isCompleted, true),
        isNull(workoutSets.deletedAt),
        isNull(workoutExercises.deletedAt),
      ),
    );

  return row?.value ?? 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The session was not created.';
}
