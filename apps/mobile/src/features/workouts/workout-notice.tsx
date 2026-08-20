/**
 * Keeps the ongoing workout notification in sync with the open session.
 *
 * Mounted at the app root alongside `RestCues`, for the same reason: the
 * notification has to survive the user leaving `/workout/active` to browse
 * their history or pick an exercise, and a component that lived on that screen
 * would stop updating the moment they navigated away.
 *
 * Renders nothing.
 */

import { formatDuration } from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { ONGOING_WORKOUT_TYPE } from '@/features/notifications/presentation';
import { clearWorkoutNotice, showWorkoutNotice } from '@/features/notifications/workout';
import { useTicker } from '@/hooks/use-ticker';
import { useTimer } from '@/store/timer';

/**
 * How often the notification body is recomputed.
 *
 * Elapsed time is rendered to the minute and rest to ten seconds, so most
 * ticks produce a string identical to the last one and are dropped before they
 * reach the OS. Ten seconds keeps a rest countdown in the shade within a few
 * seconds of the truth without re-posting every second.
 */
const REFRESH_MS = 10_000;

export function WorkoutNotice() {
  const { rows: activeRows, loaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt))),
  );

  const workout = activeRows[0];
  const workoutId = workout?.id ?? '';

  // Joined rather than resolved separately: the notification needs one string
  // per exercise, and a join is cheaper than a second query plus a lookup.
  const { data: links = [] } = useLiveQuery(
    db
      .select({ id: workoutExercises.id, name: exercises.name })
      .from(workoutExercises)
      .innerJoin(exercises, eq(exercises.id, workoutExercises.exerciseId))
      .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
      .orderBy(asc(workoutExercises.position)),
    [workoutId],
  );

  const linkIds = links.map((link) => link.id);
  const linkKey = linkIds.join(',');

  const { data: sets = [] } = useLiveQuery(
    db
      .select({
        workoutExerciseId: workoutSets.workoutExerciseId,
        isCompleted: workoutSets.isCompleted,
      })
      .from(workoutSets)
      // An empty IN () is invalid SQL, so fall back to a sentinel matching nothing.
      .where(
        and(
          inArray(workoutSets.workoutExerciseId, linkIds.length > 0 ? linkIds : ['__none__']),
          isNull(workoutSets.deletedAt),
        ),
      ),
    [linkKey],
  );

  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restExerciseName = useTimer((state) => state.restExerciseName);

  const running = Boolean(workout);
  const now = useTicker(REFRESH_MS, running);

  // Tapping the notification returns to the session rather than merely
  // foregrounding whichever screen happened to be open last.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type !== ONGOING_WORKOUT_TYPE) return;
      router.navigate('/workout/active');
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // "Not answered yet" is not "no session". Every cold start renders one
    // frame with drizzle's seeded empty result, and clearing on that frame
    // tore down a notification that had survived the process — the shade
    // blinked, and the OS re-posted it as new a tick later, which on Android
    // means the sound and the heads-up banner again.
    if (!loaded) return;

    if (!workout) {
      void clearWorkoutNotice();
      return;
    }

    const completed = sets.filter((set) => set.isCompleted).length;
    const elapsedMinutes = Math.max(
      0,
      Math.floor((now - new Date(workout.startedAt).getTime()) / 60_000),
    );

    const parts: string[] = [];

    if (restEndsAt !== null) {
      // Rounded to this component's own refresh interval, so the shade never
      // shows a countdown visibly jumping in stale steps.
      const remaining = Math.max(0, Math.round((restEndsAt - now) / 10_000) * 10);
      parts.push(remaining > 0 ? `Resting ${formatDuration(remaining)}` : 'Rest complete');
      if (restExerciseName) parts.push(restExerciseName);
    } else {
      const current = currentExerciseName(links, sets);
      if (current) parts.push(current);
    }

    parts.push(completed === 1 ? '1 set' : `${completed} sets`);
    parts.push(elapsedMinutes < 1 ? 'just started' : `${elapsedMinutes} min`);

    void showWorkoutNotice({ workoutName: workout.name, detail: parts.join(' · ') });
  }, [loaded, workout, links, sets, now, restEndsAt, restExerciseName]);

  // No unmount cleanup: a workout still open when this unmounts should keep its
  // notification — that is the whole point. Finishing and discarding clear it.

  return null;
}

/**
 * The exercise the user is most likely on: the first one, in order, that still
 * has an unchecked set. Falls back to the last exercise, which is where they
 * are once everything is ticked.
 */
function currentExerciseName(
  links: { id: string; name: string }[],
  sets: { workoutExerciseId: string; isCompleted: boolean }[],
): string | null {
  for (const link of links) {
    const own = sets.filter((set) => set.workoutExerciseId === link.id);
    if (own.length > 0 && own.some((set) => !set.isCompleted)) return link.name;
  }

  return links[links.length - 1]?.name ?? null;
}
