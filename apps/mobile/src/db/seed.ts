/**
 * Seeds the built-in exercise library.
 *
 * The library is ~6,800 exercises, so unlike the small curated list this
 * replaced, re-running it is *not* cheap: it is well over a hundred multi-row
 * upserts, and it blocks the splash screen. A fingerprint in `sync_meta` gates
 * the whole thing, so the cost is paid on first launch and then again only when
 * a new app release actually ships a different catalog.
 */

import { EXERCISE_LIBRARY } from '@lift/shared/exercises';
import { eq, sql } from 'drizzle-orm';

import { db } from './client';
import { exercises, syncMeta } from './schema';

// Drizzle exposes no first-class `excluded.*` helper for SQLite upserts, so the
// conflict-target columns drop to raw SQL.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/**
 * SQLite caps the number of bound parameters per statement. At 17 columns a
 * single insert of the whole library would be six figures of placeholders, so
 * we chunk. 50 rows keeps us far below every historical limit.
 */
const CHUNK_SIZE = 50;

const CATALOG_FINGERPRINT_KEY = 'exercise_catalog_fingerprint';

/**
 * Cheap stand-in for hashing the catalog: its length plus the last id. Both
 * change whenever the generator is re-run against new source data, and neither
 * costs anything to compute at startup.
 */
const CATALOG_FINGERPRINT = `${EXERCISE_LIBRARY.length}:${
  EXERCISE_LIBRARY[EXERCISE_LIBRARY.length - 1]?.id ?? ''
}`;

export async function seedExerciseLibrary(): Promise<void> {
  const [meta] = await db
    .select({ value: syncMeta.value })
    .from(syncMeta)
    .where(eq(syncMeta.key, CATALOG_FINGERPRINT_KEY))
    .limit(1);

  if (meta?.value === CATALOG_FINGERPRINT) return;

  const now = Date.now();

  /**
   * ~137 chunked upserts, and deliberately no transaction around them.
   *
   * The chunking is what actually pays: SQLite commits and fsyncs once per
   * statement, so 137 statements instead of 6,800 is the difference between a
   * visibly long splash and well under a second. Wrapping the loop in
   * `db.transaction` looks like it would help further, but this driver runs
   * `begin`, the callback and `commit` synchronously: an async callback
   * commits at its first `await`, leaving every chunk after the first outside
   * the transaction. It would buy one chunk's worth of nothing.
   */
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
          thumbnailUrl: exercise.thumbnailUrl,
          videoUrl: exercise.videoUrl,
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
         * Refresh only canonical library data. `isArchived`, `notes`,
         * `defaultRestSeconds` and the two unit overrides are deliberately
         * excluded. Those are the user's, and overwriting them would undo
         * their customisations on the next launch that ships a new catalog.
         *
         * The rule for anything added to `exercises` later: if the user can
         * change it, it does not belong in this set.
         */
        set: {
          name: sqlExcluded('name'),
          equipment: sqlExcluded('equipment'),
          primaryMuscle: sqlExcluded('primary_muscle'),
          secondaryMuscles: sqlExcluded('secondary_muscles'),
          trackingType: sqlExcluded('tracking_type'),
          thumbnailUrl: sqlExcluded('thumbnail_url'),
          videoUrl: sqlExcluded('video_url'),
        },
      });
  }

  // Written last: a crash mid-seed leaves the fingerprint absent, so the next
  // launch retries rather than declaring a half-populated library complete.
  await db
    .insert(syncMeta)
    .values({ key: CATALOG_FINGERPRINT_KEY, value: CATALOG_FINGERPRINT })
    .onConflictDoUpdate({
      target: syncMeta.key,
      set: { value: CATALOG_FINGERPRINT },
    });
}

/** True when the library has never been seeded. Used to show first-run UI. */
export async function isFirstLaunch(): Promise<boolean> {
  const [row] = await db.select({ id: exercises.id }).from(exercises).limit(1);
  return row === undefined;
}
