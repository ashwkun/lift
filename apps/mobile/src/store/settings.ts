/**
 * User preferences.
 *
 * Held in a Zustand store for synchronous reads (formatting code runs inside
 * render and can't await), and mirrored into the `settings` table so they
 * survive restarts. Writes update memory first and persist in the background —
 * a preference toggle should never feel like it waits on disk.
 */

import {
  defaultBarKg,
  USES_BODYWEIGHT,
  type DistanceUnit,
  type MeasurementUnit,
  type OneRepMaxFormula,
  type Sex,
  type ThemePreference,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { create } from 'zustand';

import { db } from '@/db/client';
import { bodyMeasurements, settings as settingsTable } from '@/db/schema';

export interface Settings {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  measurementUnit: MeasurementUnit;
  themePreference: ThemePreference;

  /** Fallback rest duration when an exercise defines none. */
  defaultRestSeconds: number;
  restTimerEnabled: boolean;
  /** Start the rest timer automatically when a set is checked off. */
  restTimerAutoStart: boolean;
  restTimerNotifications: boolean;
  /** Buzz on each of the last three seconds, so the cue starts before zero. */
  restTimerCountdownCues: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /** Keep the screen on during an active workout. */
  keepAwakeDuringWorkout: boolean;

  oneRepMaxFormula: OneRepMaxFormula;
  /** Default barbell weight for the plate calculator, in kg. */
  barWeightKg: number;
  /**
   * 0 = Sunday, 1 = Monday. Which column the calendar's grid starts on.
   *
   * The weekly streak and the history buckets are Monday-based regardless —
   * see `weekKey` in `@lift/shared` — so this is deliberately described to the
   * user as a calendar setting and nothing more.
   */
  firstDayOfWeek: 0 | 1;

  /**
   * Used to value bodyweight exercises. Null means push-ups and pull-ups log
   * zero volume, so this is mirrored from every bodyweight entry in
   * Measurements rather than being a second number the user has to maintain.
   */
  bodyweightKg: number | null;

  /**
   * Height in centimetres, and the sex the body-fat regression is fitted for.
   *
   * Both exist for the derived figures on the measurements screen — BMI and
   * waist-to-height need the height, the US Navy body-fat estimate needs both —
   * and for nothing else. Null is a supported state throughout: leaving either
   * blank costs only the estimates that depend on it, so neither is ever asked
   * for as a condition of logging a measurement.
   */
  heightCm: number | null;
  sex: Sex | null;

  /** Prompts the routine to update when sets change mid-workout. */
  promptRoutineUpdate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  weightUnit: 'kg',
  distanceUnit: 'km',
  measurementUnit: 'cm',
  themePreference: 'system',

  defaultRestSeconds: 120,
  restTimerEnabled: true,
  restTimerAutoStart: true,
  restTimerNotifications: true,
  restTimerCountdownCues: true,
  soundEnabled: true,
  hapticsEnabled: true,
  keepAwakeDuringWorkout: true,

  oneRepMaxFormula: 'brzycki',
  // Read from the same place `update` reads it, so "still the default" is a
  // comparison against one constant rather than against a literal that has to
  // be kept in step with `packages/shared/src/plates.ts` by hand.
  barWeightKg: defaultBarKg('kg'),
  firstDayOfWeek: 1,

  bodyweightKg: null,
  heightCm: null,
  sex: null,

  promptRoutineUpdate: true,
};

interface SettingsStore extends Settings {
  /** False until the persisted values have been read back from SQLite. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => Promise<void>;
}

const SETTINGS_KEY = 'user_settings';

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    let stored: Partial<Settings> = {};

    try {
      const [row] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, SETTINGS_KEY))
        .limit(1);

      if (row?.value) stored = JSON.parse(row.value) as Partial<Settings>;
    } catch {
      // A corrupt or unreadable row should not block app start — fall through
      // to defaults, which will be rewritten on the next change.
    }

    // Spread defaults first so a settings key added in a later release gets a
    // sensible value instead of `undefined`.
    const next: Settings = { ...DEFAULT_SETTINGS, ...stored };

    // Backfill from the measurement log. Until this release nothing ever wrote
    // `bodyweightKg`, so every user who had logged a bodyweight in Measurements
    // was still valuing their push-ups at zero. The number is already on the
    // device; asking for it again would be asking the user to fix our bug.
    if (next.bodyweightKg == null) {
      const logged = await readLatestBodyweightKg();
      if (logged != null) {
        next.bodyweightKg = logged;
        void persist(next);
      }
    }

    set({ ...next, hydrated: true });
  },

  update: (key, value) => {
    const patch: Partial<Settings> = { [key]: value };

    /*
     * Switching weight units brings the bar with them — but only while it is
     * still whichever default it arrived as.
     *
     * A kg gym's bar is 20 kg and a lb gym's is 45 lb, and those are different
     * bars, not one bar described twice. Leaving the stored 20 kg alone when
     * someone switched to lb gave them a "44.09 lb" bar: an oddly precise
     * number that is wrong in every gym on that side of the Atlantic, sitting
     * under a plate calculator that then solved for the wrong remainder.
     *
     * Guarded on the old default rather than applied unconditionally, because
     * the alternative is silently overwriting a real preference. Someone who
     * set a 15 kg bar meant it, and a unit switch is not a request to forget
     * that — they get their 15 kg bar rendered as 33.07 lb, which is at least
     * the bar they own.
     */
    if (key === 'weightUnit') {
      const to = value as WeightUnit;
      const from: WeightUnit = to === 'kg' ? 'lb' : 'kg';
      if (get().barWeightKg === defaultBarKg(from)) patch.barWeightKg = defaultBarKg(to);
    }

    set(patch as Pick<Settings, typeof key>);
    void persist(get());
  },

  reset: async () => {
    set({ ...DEFAULT_SETTINGS, hydrated: true });
    await persist(get());
  },
}));

/**
 * Latest bodyweight from the measurement log, in kg.
 *
 * Read straight off the table rather than through
 * `features/measurements/repository`, which imports this store to mirror new
 * entries into it — going the other way too would close the cycle.
 */
async function readLatestBodyweightKg(): Promise<number | null> {
  try {
    const [row] = await db
      .select({ value: bodyMeasurements.value })
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(1);

    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a set of tracking types needs a bodyweight the app does not have.
 *
 * Read imperatively because the only caller is an event handler (finishing a
 * workout), and because the answer has to be true *at that moment* rather than
 * at the last render. `USES_BODYWEIGHT`, not `TRACKING_FIELDS` — see the note
 * beside it in `@lift/shared`: a push-up renders no weight field yet its whole
 * volume is bodyweight.
 */
export function bodyweightMissingFor(trackingTypes: Iterable<TrackingType>): boolean {
  if (useSettings.getState().bodyweightKg != null) return false;
  for (const trackingType of trackingTypes) {
    if (USES_BODYWEIGHT.has(trackingType)) return true;
  }
  return false;
}

async function persist(state: Settings): Promise<void> {
  const payload: Settings = {
    weightUnit: state.weightUnit,
    distanceUnit: state.distanceUnit,
    measurementUnit: state.measurementUnit,
    themePreference: state.themePreference,
    defaultRestSeconds: state.defaultRestSeconds,
    restTimerEnabled: state.restTimerEnabled,
    restTimerAutoStart: state.restTimerAutoStart,
    restTimerNotifications: state.restTimerNotifications,
    restTimerCountdownCues: state.restTimerCountdownCues,
    soundEnabled: state.soundEnabled,
    hapticsEnabled: state.hapticsEnabled,
    keepAwakeDuringWorkout: state.keepAwakeDuringWorkout,
    oneRepMaxFormula: state.oneRepMaxFormula,
    barWeightKg: state.barWeightKg,
    firstDayOfWeek: state.firstDayOfWeek,
    bodyweightKg: state.bodyweightKg,
    heightCm: state.heightCm,
    sex: state.sex,
    promptRoutineUpdate: state.promptRoutineUpdate,
  };

  await db
    .insert(settingsTable)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(payload), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: JSON.stringify(payload), updatedAt: Date.now() },
    });
}
