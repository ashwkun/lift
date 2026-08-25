/**
 * `home-widgets`: the two Lift tiles that live on the Android home screen.
 *
 * A local Expo module for the reason `workout-live/index.ts` gives at length:
 * `android/` is generated and gitignored, and everything here survives
 * `expo prebuild --clean`.
 *
 * ## Why a snapshot rather than a query
 *
 * A widget is drawn by the launcher, in a process that is usually not this app
 * and never has JavaScript in it. It cannot open the database: not because the
 * file is out of reach, but because reading it correctly means knowing about
 * soft deletes, the sync oplog and the unit preferences, and a second
 * implementation of any of those would be a second answer to a question the app
 * already answers. `WorkoutLiveReceiver.kt` refuses the same temptation for the
 * same reason.
 *
 * So the app publishes a *description* — strings already formatted by
 * `@lift/shared`, colours already resolved from the active palette, and the deep
 * link each row opens — and the native half is a painter that knows nothing
 * about workouts, kilograms, themes or routes.
 * `features/home-widgets/publisher.tsx` is the other side.
 *
 * The one thing the description deliberately does not carry is an elapsed time.
 * The resume banner's clock is a `Chronometer` handed the epoch the session
 * started at, ticked by the launcher, exactly as the ongoing notification does
 * it.
 *
 * Android only. On iOS and in Expo Go `requireOptionalNativeModule` returns null
 * and every export below no-ops, the same shape every other native module in
 * this app uses.
 */

import { requireOptionalNativeModule } from 'expo';

/** One tappable row of the routines widget. */
export interface HomeWidgetRow {
  name: string;
  /**
   * The right-hand column: "2 days ago" once a routine has been performed, "6
   * exercises" before that. Already in words — nothing native formats a date.
   * Empty hides the column rather than drawing a gap.
   */
  meta: string;
  /** A `lift://` deep link. The native side never builds one. */
  link: string;
}

/**
 * Everything both widgets draw.
 *
 * Flat, fully formatted and self-contained: what the native side receives is
 * what it paints. The empty state is a row like any other, so there is no branch
 * in Kotlin deciding what "no routines yet" should say or where it should go.
 */
export interface HomeWidgetSnapshot {
  /** "82.4 kg", or the prompt shown when nothing has been logged. */
  weightValue: string;
  /** "−0.3 kg · 2 days ago", or the prompt's second line. */
  weightDetail: string;
  /**
   * Whether `weightValue` is a reading or a prompt. Only decides the type size:
   * a prompt is a sentence and does not fit at the size a number does.
   */
  weightLogged: boolean;
  weightLink: string;

  /** In the user's own order, capped to `MAX_WIDGET_ROWS`. */
  rows: HomeWidgetRow[];

  /** The always-last row: an ad-hoc session with no routine behind it. */
  startLabel: string;
  startLink: string;

  /** The open session's name, or null. Turns the header into a resume banner. */
  activeTitle: string | null;
  /** Epoch ms it started. Ticked by the launcher, never by this app. */
  activeStartedAtMs: number | null;
  /** Where the header goes: the open session, or the routines list. */
  headerLink: string;

  /** `#RRGGBB`, all five from the active palette. */
  surfaceColor: string;
  rowColor: string;
  textColor: string;
  mutedColor: string;
  accentColor: string;
}

interface HomeWidgetsNativeModule {
  publish(snapshot: HomeWidgetSnapshot): Promise<void>;
}

const native = requireOptionalNativeModule<HomeWidgetsNativeModule>('HomeWidgets');

/** False on iOS, on the web, and in Expo Go, where the native half is not in the binary. */
export const homeWidgetsAvailable = native !== null;

/**
 * The tallest widget's row count, and therefore how many rows are worth sending.
 *
 * `MAX_SLOTS` in `RoutinesWidgetProvider.kt` is this number. It is stated in
 * both places rather than derived, because deriving it would mean a bridge call
 * on every publish to learn something that has not changed since the module was
 * written.
 */
export const MAX_WIDGET_ROWS = 8;

/**
 * Stores the description and redraws every placed widget.
 *
 * Stored unconditionally, whether or not a widget is on a home screen right now.
 * A widget added tomorrow is drawn from whatever was last published, and the
 * alternative — asking `AppWidgetManager` how many are placed and skipping the
 * write when the answer is zero — means the first thing a newly added widget
 * shows is the state of the app at some arbitrary earlier moment.
 */
export async function publishHomeWidgets(snapshot: HomeWidgetSnapshot): Promise<void> {
  await native?.publish(snapshot);
}
