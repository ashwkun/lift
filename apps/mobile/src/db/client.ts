/**
 * SQLite connection and Drizzle instance.
 *
 * On a phone the handle is native and opening it is a function call, so `db`
 * exists the moment this module is imported and every consumer can simply use
 * it. That was the whole design, and on native nothing here has changed.
 *
 * In a browser it is a round trip to a worker that has to fetch and instantiate
 * ~750KB of WebAssembly before it can answer anything — and `openDatabaseSync`
 * cannot wait that long. expo-sqlite's synchronous bridge busy-waits on a
 * SharedArrayBuffer, and its escape hatch is a spin budget:
 *
 *     while (Atomics.load(lock, 0) === PENDING) {
 *       if (++i > 1_000_000) throw new Error('Sync operation timeout');
 *       Atomics.pause();
 *     }
 *
 * A million `Atomics.pause()` spins is a few tens of milliseconds on a modern
 * CPU. A cold worker misses that every time, so the open throws — from module
 * scope, before a single screen has rendered, which takes the whole app down at
 * import. (The older fallback loop, on engines without `Atomics.pause`, runs a
 * thousand times as many iterations and usually squeaks through, which is why
 * this only started happening on current browsers.)
 *
 * So on web the database is opened **asynchronously**. That boots the same
 * worker over `postMessage`, with no deadline at all, and `databaseReady` is
 * what the root layout holds the splash on. Every synchronous call after it —
 * which is most of what Drizzle does — is answered by a worker that is already
 * warm and comes back in well under a millisecond, so the budget stops being
 * something anyone has to think about.
 *
 * **Nothing may touch `db` before `databaseReady` resolves.** In practice
 * nothing can: every consumer reads it from inside a hook, an effect or an
 * event handler, and none of those run until `Bootstrap` has waited for it.
 * `isDatabaseOpen()` is what that gate asks.
 */

import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import * as schema from './schema';

/**
 * Deliberately still `ironlog.db`, the name used before the app was renamed.
 *
 * Nothing reads this but SQLite. Renaming it would not open the existing file
 * under a new name — it would open a new, empty database and leave every logged
 * workout stranded in a file the app no longer looks at. The cosmetic win is not
 * worth silently wiping someone's training history; migrating would mean copying
 * the file on first launch, which is a real change and not a rename.
 */
export const DATABASE_NAME = 'ironlog.db';

/**
 * `enableChangeListener` powers Drizzle's `useLiveQuery`, which re-runs a query
 * whenever the underlying tables change. That's what keeps the workout screen,
 * history list and stats in sync without manual invalidation.
 */
const OPTIONS = { enableChangeListener: true } as const;

/**
 * Pragmas must run before any query.
 *
 * - `foreign_keys = ON`: SQLite defaults this **off**, which would silently
 *   ignore every `onDelete: 'cascade'` in the schema and leave orphaned sets
 *   behind whenever a workout is removed.
 * - `journal_mode = WAL`: readers no longer block on the writer, which matters
 *   because the rest timer and live stats query while sets are being written.
 *   The browser's VFS has no WAL to give and answers with the mode it kept,
 *   which is a returned row rather than an error.
 * - `busy_timeout`: wait rather than immediately throwing SQLITE_BUSY if the
 *   sync engine happens to be writing.
 */
const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

// Assigned by `adopt`, which `databaseReady` below guarantees has run. The
// definite-assignment assertions are the price of `db` staying an ordinary
// import for the fifty-odd modules that use it, rather than every one of them
// learning that the web has a startup phase.
export let sqlite!: SQLiteDatabase;
export let db!: Database;

let opened = false;

/** Whether `db` is usable this instant. False on web until the worker answers. */
export function isDatabaseOpen(): boolean {
  return opened;
}

function adopt(instance: SQLiteDatabase): void {
  sqlite = instance;
  instance.execSync(PRAGMAS);
  db = drizzle(instance, { schema });
  opened = true;
}

/**
 * Resolves once `db` is safe to use. Already resolved on native, where the open
 * happened during this module's evaluation.
 *
 * A rejection here is a startup failure like a failed migration, and is
 * reported the same way — see `Bootstrap`.
 */
export const databaseReady: Promise<void> = openDatabase();

function openDatabase(): Promise<void> {
  if (Platform.OS !== 'web') {
    adopt(openDatabaseSync(DATABASE_NAME, OPTIONS));
    return Promise.resolve();
  }

  return openDatabaseAsync(DATABASE_NAME, OPTIONS).then(adopt);
}

export { schema };
