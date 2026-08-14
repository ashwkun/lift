/**
 * Seeds the built-in exercise library.
 *
 * Runs on every launch (it's a fast no-op once populated) so that a library
 * expanded in a later app release lands on devices that already have data.
 */

import { EXERCISE_LIBRARY } from '@ironlog/shared';
import { sql } from 'drizzle-orm';

import { db } from './client';
import { exercises } from './schema';

// Drizzle exposes no first-class `excluded.*` helper for SQLite upserts, so the
// conflict-target columns drop to raw SQL.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/**
 * SQLite caps the number of bound parameters per statement. At 15 columns a
 * single insert of the whole library would be well over 3,000 placeholders, so
 * we chunk. 50 rows keeps us far below every historical limit.
 */
const CHUNK_SIZE = 50;

export async function seedExerciseLibrary(): Promise<void> {
  const now = Date.now();

  for (let i = 0; i < EXERCISE_LIBRARY.length; i += CHUNK_SIZE) {
    const chunk = EXERCISE_LIBRARY.slice(i, i + CHUNK_SIZE);

    await db
      .insert(exercises)
      .values(
        chunk.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          equipment: exercise.equipment,
          primaryMuscle: exercise.primaryMuscle,
          secondaryMuscles: exercise.secondaryMuscles,
          trackingType: exercise.trackingType,
          isCustom: false,
          createdAt: now,
          updatedAt: now,
          // Built-ins are identical on every device and never cross the wire.
          syncState: 'synced' as const,
        })),
      )
      .onConflictDoUpdate({
        target: exercises.id,
        /**
         * Refresh only canonical library data. `isArchived`, `notes` and
         * `defaultRestSeconds` are deliberately excluded — those are the user's,
         * and overwriting them on every launch would undo their customisations.
         */
        set: {
          name: sqlExcluded('name'),
          equipment: sqlExcluded('equipment'),
          primaryMuscle: sqlExcluded('primary_muscle'),
          secondaryMuscles: sqlExcluded('secondary_muscles'),
          trackingType: sqlExcluded('tracking_type'),
        },
      });
  }
}

/** True when the library has never been seeded — used to show first-run UI. */
export async function isFirstLaunch(): Promise<boolean> {
  const [row] = await db.select({ id: exercises.id }).from(exercises).limit(1);
  return row === undefined;
}
