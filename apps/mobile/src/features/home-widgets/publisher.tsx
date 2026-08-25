/**
 * Keeps the two Android home-screen widgets in sync with the app.
 *
 * Mounted at the app root alongside `WorkoutNotice`, and for the same reason:
 * what the widgets show — the routine list, the newest weigh-in, whether a
 * session is open — changes from screens all over the app, and a component that
 * lived on any one of them would stop publishing the moment the user navigated
 * away.
 *
 * ## What crosses the bridge
 *
 * A finished description, never data. Every string is formatted here by the same
 * `@lift/shared` helpers the screens use, every colour is resolved from the
 * active palette, and every row carries the `lift://` link it opens.
 * `modules/home-widgets` paints it and knows nothing else — the note at the top
 * of that module explains why that division is not optional.
 *
 * ## `asOf`, and why the links carry a token
 *
 * Widget taps are `PendingIntent`s, fixed when the widget is drawn. A link that
 * said `?start=1` would be byte-identical on every tap, so the second tap of a
 * routine — after dismissing the "a workout is in progress" dialog, say — would
 * navigate to a route the app is already on with parameters it has already
 * obeyed, and nothing would happen.
 *
 * So the links carry a token, and the token is `asOf`: the moment the app last
 * left the foreground. That is exactly the right clock for this. To tap a widget
 * you have to be looking at your home screen, which means the app went to the
 * background first, which means the token moved between the tap you made and the
 * tap before it. `useLaunchAction` and the `?log=` latch in
 * `app/measurement/[kind].tsx` are what read it.
 *
 * It earns its keep twice: it is also the clock the "2 days ago" strings are
 * computed against, so putting the app away is what refreshes them rather than
 * leaving yesterday's wording on the home screen.
 *
 * Renders nothing.
 */

import {
  daysSince,
  formatMeasurementDelta,
  formatMeasurementValue,
  isNegligibleChange,
  type MeasurementUnitPreferences,
} from '@lift/shared';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  homeWidgetsAvailable,
  publishHomeWidgets,
  MAX_WIDGET_ROWS,
  type HomeWidgetRow,
  type HomeWidgetSnapshot,
} from '@modules/home-widgets';

import { db } from '@/db/client';
import { bodyMeasurements, routineExercises, routines, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { describeRecency } from '@/features/measurements/insights';
import { useSettings } from '@/store/settings';
import { useColors } from '@/theme';

/**
 * Mounted everywhere, subscribing only where the native half exists.
 *
 * `publishHomeWidgets` already no-ops on iOS, on the web and in Expo Go, but the
 * four live queries below do not: they would subscribe, re-run on every write
 * and format strings for a home screen that cannot have a widget on it. The flag
 * is a module constant, so this branch is decided once at import and the hooks
 * below it never change order.
 */
export function HomeWidgets() {
  if (!homeWidgetsAvailable) return null;
  return <Publisher />;
}

function Publisher() {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);

  const asOf = useLastBackgrounded();

  const { rows: routineRows, loaded: routinesLoaded } = useRows(
    db
      .select({
        id: routines.id,
        name: routines.name,
        lastPerformedAt: routines.lastPerformedAt,
      })
      .from(routines)
      .where(isNull(routines.deletedAt))
      .orderBy(asc(routines.position))
      .limit(MAX_WIDGET_ROWS),
  );

  /*
   * The exercise count per routine, for the routines that have never been
   * performed. Grouped over the whole table rather than joined onto the query
   * above, because a join would have to be a left join with a group by anyway
   * and this way the routine query stays the one-table read that `position`
   * orders. The table is small — routines times exercises-per-routine.
   */
  const { rows: exerciseCounts, loaded: countsLoaded } = useRows(
    db
      .select({ routineId: routineExercises.routineId, total: count() })
      .from(routineExercises)
      .where(isNull(routineExercises.deletedAt))
      .groupBy(routineExercises.routineId),
  );

  // Two, not one: the second is what the delta on the weight tile is measured
  // against.
  const { rows: weighIns, loaded: weighInsLoaded } = useRows(
    db
      .select({ value: bodyMeasurements.value, measuredAt: bodyMeasurements.measuredAt })
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(2),
  );

  // The same shape `useOpenSession` documents at length: one row, ordered, and
  // no join, because `workouts` is written on start, finish and discard but not
  // on the set writes that fire on every keystroke.
  const { rows: activeRows, loaded: activeLoaded } = useRows(
    db
      .select({ name: workouts.name, startedAt: workouts.startedAt })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
  );

  const loaded = routinesLoaded && countsLoaded && weighInsLoaded && activeLoaded;

  const snapshot = useMemo<HomeWidgetSnapshot | null>(() => {
    /*
     * Nothing is published until every query has answered.
     *
     * Drizzle seeds each one to `[]` (see `db/use-rows.ts`), and publishing that
     * would blank a widget full of routines for the frame or two before the real
     * rows arrive — on a *home screen*, where the user is not even looking at
     * the app and has no way to understand what they just saw.
     */
    if (!loaded) return null;

    const prefs: MeasurementUnitPreferences = { weightUnit, measurementUnit };
    const active = activeRows[0];
    const countByRoutine = new Map(exerciseCounts.map((row) => [row.routineId, row.total]));

    return {
      ...weightTile(weighIns, prefs, asOf),
      rows: routineRows.length > 0
        ? routineRows.map((routine) => routineRow(routine, countByRoutine, asOf))
        : [{ name: 'No routines yet', meta: 'Add one', link: ROUTINES_LINK }],
      startLabel: 'Start empty workout',
      startLink: `${ROUTINES_LINK}?start=${asOf}`,
      activeTitle: active?.name ?? null,
      activeStartedAtMs: active?.startedAt.getTime() ?? null,
      headerLink: active ? ACTIVE_LINK : ROUTINES_LINK,
      surfaceColor: colors.surface,
      rowColor: colors.surfaceMuted,
      textColor: colors.text,
      mutedColor: colors.textSecondary,
      accentColor: colors.accent,
    };
  }, [
    loaded,
    asOf,
    routineRows,
    exerciseCounts,
    weighIns,
    activeRows,
    weightUnit,
    measurementUnit,
    colors,
  ]);

  /*
   * The last description published, serialised.
   *
   * Four live queries and a palette drive this component, and most of what wakes
   * them changes nothing a widget shows: a set logged mid-workout re-runs the
   * active-session query and produces a byte-identical snapshot. Comparing here
   * is what keeps this at a handful of bridge calls and file writes per session
   * rather than one per render. `features/notifications/live.ts` does the same
   * thing for the same reason.
   */
  const published = useRef<string | null>(null);

  useEffect(() => {
    if (snapshot === null) return;

    const serialised = JSON.stringify(snapshot);
    if (serialised === published.current) return;
    published.current = serialised;

    void publishHomeWidgets(snapshot);
  }, [snapshot]);

  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** The routines list, the open session, and one routine's editor. */
const ROUTINES_LINK = 'lift://workout';
const ACTIVE_LINK = 'lift://workout/active';
const ROUTINE_LINK = 'lift://routine';

/**
 * The bodyweight route, and the `?log=` convention it already understands.
 *
 * Not a route of the widget's own: `features/notifications/weigh-in-responder`
 * routes here with the same parameter when its notification is tapped rather
 * than typed into, and the screen opens the entry sheet during render for it.
 * Two ways in, one contract.
 */
const WEIGHT_LINK = 'lift://measurement/bodyweight';

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

type WeighIn = { value: number; measuredAt: Date };
type RoutineRow = { id: string; name: string; lastPerformedAt: Date | null };

/** The three fields of the weight tile, and where it goes. */
function weightTile(
  weighIns: readonly WeighIn[],
  prefs: MeasurementUnitPreferences,
  asOf: number,
): Pick<HomeWidgetSnapshot, 'weightValue' | 'weightDetail' | 'weightLogged' | 'weightLink'> {
  const link = `${WEIGHT_LINK}?log=${asOf}`;
  const [latest, previous] = weighIns;

  if (!latest) {
    return {
      weightValue: 'Log weight',
      weightDetail: 'Tap to add your first',
      weightLogged: false,
      weightLink: link,
    };
  }

  const recency = describeRecency(daysSince(latest.measuredAt.getTime(), asOf));

  /*
   * The delta is dropped rather than printed as "0.0 kg" when the change is
   * below what the display can show, which is the rule `formatMeasurementDelta`
   * states and `bodyweight-card.tsx` follows. On a tile two lines tall, a
   * meaningless figure costs the recency its place.
   */
  const delta =
    previous && !isNegligibleChange('bodyweight', latest.value - previous.value, prefs)
      ? formatMeasurementDelta('bodyweight', latest.value - previous.value, prefs)
      : null;

  return {
    weightValue: formatMeasurementValue('bodyweight', latest.value, prefs),
    weightDetail: [delta, recency].filter(Boolean).join(' · '),
    weightLogged: true,
    weightLink: link,
  };
}

/**
 * One routine row.
 *
 * The right-hand column answers whichever question is worth asking about that
 * routine. Once it has been performed, that question is "have I already done
 * this one this week", so it shows recency. Before that there is no history to
 * report and the useful fact is how much work it is.
 */
function routineRow(
  routine: RoutineRow,
  counts: ReadonlyMap<string, number>,
  asOf: number,
): HomeWidgetRow {
  const performed = routine.lastPerformedAt;
  const total = counts.get(routine.id) ?? 0;

  return {
    name: routine.name,
    meta: performed
      ? describeRecency(daysSince(performed.getTime(), asOf))
      : `${total} ${total === 1 ? 'exercise' : 'exercises'}`,
    link: `${ROUTINE_LINK}/${encodeURIComponent(routine.id)}?start=${asOf}`,
  };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * The moment the app last left the foreground, seeded with now.
 *
 * See the note at the top of this file: this is both the token the widget links
 * carry and the clock their relative dates are measured against, and it moves at
 * exactly the moment a widget becomes the thing the user can see.
 *
 * Deliberately not a ticker. Nothing on either widget needs to move while the
 * app is open — the one thing that does, the resume banner's clock, is a
 * `Chronometer` the launcher ticks by itself.
 */
function useLastBackgrounded(): number {
  const [asOf, setAsOf] = useState(() => Date.now());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      setAsOf(Date.now());
    });

    return () => subscription.remove();
  }, []);

  return asOf;
}
