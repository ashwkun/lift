/**
 * User preferences.
 *
 * Held in a Zustand store for synchronous reads (formatting code runs inside
 * render and can't await), and mirrored into the `settings` table so they
 * survive restarts. Writes update memory first and persist in the background —
 * a preference toggle should never feel like it waits on disk.
 */

import type {
  DistanceUnit,
  MeasurementUnit,
  OneRepMaxFormula,
  ThemePreference,
  WeightUnit,
} from '@ironlog/shared';
import { eq } from 'drizzle-orm';
import { create } from 'zustand';

import { db } from '@/db/client';
import { settings as settingsTable } from '@/db/schema';

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
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /** Keep the screen on during an active workout. */
  keepAwakeDuringWorkout: boolean;

  oneRepMaxFormula: OneRepMaxFormula;
  /** Default barbell weight for the plate calculator, in kg. */
  barWeightKg: number;
  /** 0 = Sunday, 1 = Monday. Affects the calendar and weekly stats. */
  firstDayOfWeek: 0 | 1;

  /** Used to convert bodyweight exercises into volume. */
  bodyweightKg: number | null;

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
  soundEnabled: true,
  hapticsEnabled: true,
  keepAwakeDuringWorkout: true,

  oneRepMaxFormula: 'brzycki',
  barWeightKg: 20,
  firstDayOfWeek: 1,

  bodyweightKg: null,

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
    try {
      const [row] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, SETTINGS_KEY))
        .limit(1);

      if (row?.value) {
        const stored = JSON.parse(row.value) as Partial<Settings>;
        // Spread defaults first so a settings key added in a later release gets
        // a sensible value instead of `undefined`.
        set({ ...DEFAULT_SETTINGS, ...stored, hydrated: true });
        return;
      }
    } catch {
      // A corrupt or unreadable row should not block app start — fall through
      // to defaults, which will be rewritten on the next change.
    }

    set({ hydrated: true });
  },

  update: (key, value) => {
    set({ [key]: value } as Pick<Settings, typeof key>);
    void persist(get());
  },

  reset: async () => {
    set({ ...DEFAULT_SETTINGS, hydrated: true });
    await persist(get());
  },
}));

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
    soundEnabled: state.soundEnabled,
    hapticsEnabled: state.hapticsEnabled,
    keepAwakeDuringWorkout: state.keepAwakeDuringWorkout,
    oneRepMaxFormula: state.oneRepMaxFormula,
    barWeightKg: state.barWeightKg,
    firstDayOfWeek: state.firstDayOfWeek,
    bodyweightKg: state.bodyweightKg,
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
