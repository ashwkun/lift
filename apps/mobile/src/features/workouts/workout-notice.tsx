/**
 * Keeps the ongoing workout notification in sync with the open session.
 *
 * Mounted at the app root alongside `RestCues`, for the same reason: the
 * notification has to survive the user leaving `/workout/active` to browse
 * their history or pick an exercise, and a component that lived on that screen
 * would stop updating the moment they navigated away.
 *
 * ## Two renderers, one description
 *
 * Everything below the `describe` call is one of two ways to draw the same
 * thing. `modules/workout-live` is a native foreground service: it takes the
 * absolute epochs this component derives and hands them to Android, which ticks
 * them in SystemUI — so the countdown is live in the shade and on the lock
 * screen, there are buttons, and none of it costs a render. Where that module is
 * not in the binary (iOS, the web, Expo Go) `features/notifications/workout`
 * posts the same description as a plain `expo-notifications` body, which cannot
 * tick and so has to be re-rendered on a timer.
 *
 * That is the only reason `useTicker` is still here, and it is switched off
 * wherever the native renderer exists. The polling loop is not a fallback
 * detail — it *is* the fallback.
 *
 * Renders nothing.
 */

import { formatDuration } from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { db } from '@/db/client';
import { exercises, workoutExercises, workoutSets, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { getNotifications } from '@/features/notifications/module';
import {
  clearSessionNotice,
  onLiveNoticeActions,
  pushLiveNotice,
  workoutLiveAvailable,
  type WorkoutLiveState,
} from '@/features/notifications/live';
import { ONGOING_WORKOUT_TYPE } from '@/features/notifications/presentation';
import { showWorkoutNotice } from '@/features/notifications/workout';
import { useTicker } from '@/hooks/use-ticker';
import { useNoticeRequest } from '@/store/notice-request';
import { useTimer } from '@/store/timer';
import { useColors } from '@/theme';

import { ADJUST_SECONDS, syncRestNotification } from './rest-controls';

/**
 * How often the fallback body is recomputed.
 *
 * Only reached where `workoutLiveAvailable` is false. The native renderer needs
 * no interval at all: the two things that move — the rest countdown and the
 * elapsed clock — are absolute epochs that Android renders itself, so a change
 * to the *description* is the only thing worth a push, and there are about
 * twenty of those in a session.
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
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const restExerciseName = useTimer((state) => state.restExerciseName);
  const restKind = useTimer((state) => state.restKind);

  const accent = useColors().accent;

  const running = Boolean(workout);
  // Off entirely under the native renderer — see `REFRESH_MS`.
  const now = useTicker(REFRESH_MS, running && !workoutLiveAvailable);

  // -------------------------------------------------------------------------
  // Presses
  // -------------------------------------------------------------------------

  /**
   * Tapping the fallback notification returns to the session.
   *
   * Only the fallback needs this. The native notification carries a
   * `lift://workout/active` deep link as its content intent, so the tap is
   * routed by the OS into `MainActivity` — which is `singleTask` — and handled
   * by expo-router without any listener here.
   */
  useEffect(() => {
    if (workoutLiveAvailable) return;

    const Notifications = getNotifications();
    if (!Notifications) return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type !== ONGOING_WORKOUT_TYPE) return;
      router.navigate('/workout/active');
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!workoutLiveAvailable) return;

    return onLiveNoticeActions((actions) => {
      const timer = useTimer.getState();

      for (const action of actions) {
        switch (action.type) {
          case 'adjust-rest':
            timer.adjustRest(action.seconds);
            break;

          case 'toggle-pause':
            if (useTimer.getState().restPausedSeconds !== null) timer.resumeRest();
            else timer.pauseRest();
            break;

          case 'skip-rest':
            timer.stopRest();
            break;

          case 'complete-set':
            // Raised, not performed. `store/notice-request` explains why.
            useNoticeRequest.getState().requestCompleteSet();
            break;
        }
      }

      // Once, after the whole batch. Every rest mutation above has to move the
      // scheduled bell to match, and doing it per action would schedule and
      // cancel several times to land on the same answer.
      syncRestNotification();
    });
    // No haptics on this path on purpose: the press happened on a system
    // surface, which has already given its own feedback, and a second buzz from
    // a phone in a pocket reads as a malfunction.
  }, []);

  // -------------------------------------------------------------------------
  // Description
  // -------------------------------------------------------------------------

  const completed = sets.filter((set) => set.isCompleted).length;
  const hasUnchecked = sets.some((set) => !set.isCompleted);
  const currentExercise = useMemo(() => currentExerciseName(links, sets), [links, sets]);

  const live = useMemo<WorkoutLiveState | null>(() => {
    if (!workout) return null;

    return {
      title: workout.name,
      line: [currentExercise, `${completed} ${completed === 1 ? 'set' : 'sets'}`]
        .filter(Boolean)
        .join(' · '),
      startedAtMs: new Date(workout.startedAt).getTime(),
      restEndsAtMs: restEndsAt,
      restPausedSeconds,
      restTotalSeconds,
      // A warm-up rest is capped short on purpose, and forty-five seconds where
      // two minutes was expected reads as a bug unless the shade says why —
      // the same reasoning `describeRest` applies to the on-screen bar.
      restLabel: restKind === 'warmup' ? 'Warm-up rest' : restExerciseName,
      adjustSeconds: ADJUST_SECONDS,
      canCompleteSet: hasUnchecked,
      accentColor: accent,
    };
  }, [
    workout,
    currentExercise,
    completed,
    hasUnchecked,
    restEndsAt,
    restPausedSeconds,
    restTotalSeconds,
    restExerciseName,
    restKind,
    accent,
  ]);

  useEffect(() => {
    // "Not answered yet" is not "no session". Every cold start renders one
    // frame with drizzle's seeded empty result, and clearing on that frame
    // tore down a notification that had survived the process — the shade
    // blinked, and the OS re-posted it as new a tick later, which on Android
    // means the sound and the heads-up banner again.
    if (!loaded) return;

    if (!live) {
      // A press that was never answered belongs to a workout that is over.
      useNoticeRequest.getState().clear();

      void clearSessionNotice();
      return;
    }

    if (workoutLiveAvailable) {
      void pushLiveNotice(live);
      return;
    }

    void showWorkoutNotice({ workoutName: live.title, detail: fallbackDetail(live, now) });
  }, [loaded, live, now]);

  // No unmount cleanup: a workout still open when this unmounts should keep its
  // notification — that is the whole point. Finishing and discarding clear it.

  return null;
}

/**
 * The one line `expo-notifications` gets.
 *
 * Everything the native renderer expresses structurally — a countdown, a
 * progress bar, an elapsed clock — has to collapse into text here, and text in
 * a notification body does not move. So the countdown is rounded to the refresh
 * interval rather than shown to the second: a number that is visibly ten seconds
 * stale is worse than one that was never precise.
 */
function fallbackDetail(live: WorkoutLiveState, now: number): string {
  const parts: string[] = [];

  if (live.restPausedSeconds !== null) {
    parts.push(`Rest paused ${formatDuration(live.restPausedSeconds)}`);
    if (live.restLabel) parts.push(live.restLabel);
  } else if (live.restEndsAtMs !== null) {
    const remaining = Math.max(0, Math.round((live.restEndsAtMs - now) / REFRESH_MS) * 10);
    parts.push(remaining > 0 ? `Resting ${formatDuration(remaining)}` : 'Rest complete');
    if (live.restLabel) parts.push(live.restLabel);
  } else {
    parts.push(live.line);
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - live.startedAtMs) / 60_000));
  parts.push(elapsedMinutes < 1 ? 'just started' : `${elapsedMinutes} min`);

  return parts.filter(Boolean).join(' · ');
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
