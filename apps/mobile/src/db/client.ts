/**
 * SQLite connection and Drizzle instance.
 *
 * The database is opened synchronously at module load so the rest of the app
 * can import `db` without awaiting anything — expo-sqlite's sync API is backed
 * by a native handle, not JS-thread I/O, so this is cheap.
 */

import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'ironlog.db';

/**
 * `enableChangeListener` powers Drizzle's `useLiveQuery`, which re-runs a query
 * whenever the underlying tables change. That's what keeps the workout screen,
 * history list and stats in sync without manual invalidation.
 */
export const sqlite: SQLiteDatabase = openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
});

/**
 * Pragmas must run before any query.
 *
 * - `foreign_keys = ON`: SQLite defaults this **off**, which would silently
 *   ignore every `onDelete: 'cascade'` in the schema and leave orphaned sets
 *   behind whenever a workout is removed.
 * - `journal_mode = WAL`: readers no longer block on the writer, which matters
 *   because the rest timer and live stats query while sets are being written.
 * - `busy_timeout`: wait rather than immediately throwing SQLITE_BUSY if the
 *   sync engine happens to be writing.
 */
sqlite.execSync(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
export { schema };
