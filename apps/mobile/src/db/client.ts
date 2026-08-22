/**
 * SQLite connection and Drizzle instance.
 *
 * On a phone the handle is native and opening it is a function call, so `db`
 * exists the moment this module is imported and every consumer can simply use
 * it. That was the whole design, and on native nothing here has changed.
 *
 * In a browser it is a round trip to a worker that has to fetch and instantiate
 * ~750KB of WebAssembly before it can answer anything, and `openDatabaseSync`
 * cannot wait that long. expo-sqlite's synchronous bridge busy-waits on a
 * SharedArrayBuffer, and its escape hatch is a spin budget:
 *
 *     while (Atomics.load(lock, 0) === PENDING) {
 *       if (++i > 1_000_000) throw new Error('Sync operation timeout');
 *       Atomics.pause();
 *     }
 *
 * A million `Atomics.pause()` spins is a few tens of milliseconds on a modern
 * CPU. A cold worker misses that every time, so the open throws: from module
 * scope, before a single screen has rendered, which takes the whole app down at
 * import. (The older fallback loop, on engines without `Atomics.pause`, runs a
 * thousand times as many iterations and usually squeaks through, which is why
 * this only started happening on current browsers.)
 *
 * So on web the database is opened **asynchronously**. That boots the same
 * worker over `postMessage`, with no deadline at all, and `databaseReady` is
 * what the root layout holds the splash on. Every synchronous call after it,
 * which is most of what Drizzle does. Is answered by a worker that is already
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
 * under a new name. It would open a new, empty database and leave every logged
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
 * - `busy_timeout`: wait rather than immediately throwing SQLITE_BUSY if the
 *   sync engine happens to be writing.
 */
const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`;

/**
 * The browser's subset, and the omission is the point: **no WAL**.
 *
 * WAL needs shared memory (`xShmMap`, `xShmLock`, `xShmBarrier`) and the VFS
 * the web build runs on, wa-sqlite's `AccessHandlePoolVFS`, implements none of
 * them. Asking for it does not fail politely and fall back to the journal it
 * already had: SQLite calls through a function pointer that was never filled
 * in, the WebAssembly instance traps, and the worker is left alive but unable
 * to answer anything ever again.
 *
 * That is worth spelling out because of how it presents. The next call into
 * that worker is a *synchronous* one, and the synchronous bridge reports a dead
 * worker as `Sync operation timeout`, so a pragma that cannot work reads as a
 * performance problem, on a line that never appears in the stack trace.
 *
 * Nothing is lost. WAL buys concurrent readers across connections, and on a
 * phone there are several. The sync engine writes while the logging screen
 * reads. A browser tab has one worker holding one connection.
 *
 * `busy_timeout` stays, and is not vestigial here: two tabs are two workers on
 * the same OPFS file, which is the one way this build can contend with itself.
 */
const WEB_PRAGMAS = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
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
  db = drizzle(instance, { schema });
  opened = true;
}

/**
 * Resolves once `db` is safe to use. Already resolved on native, where the open
 * happened during this module's evaluation.
 *
 * A rejection here is a startup failure like a failed migration, and is
 * reported the same way: see `Bootstrap`.
 */
export const databaseReady: Promise<void> = openDatabase();

function openDatabase(): Promise<void> {
  if (Platform.OS !== 'web') {
    const instance = openDatabaseSync(DATABASE_NAME, OPTIONS);
    instance.execSync(PRAGMAS);
    adopt(instance);
    return Promise.resolve();
  }

  return (async () => {
    const instance = await openDatabaseAsync(DATABASE_NAME, OPTIONS);
    // Asynchronously, so a pragma that the browser's VFS refuses comes back as
    // the error it is. Run through the synchronous bridge it would arrive as a
    // timeout instead, which names the transport rather than the problem, and
    // that is precisely how the WAL trap above spent a deploy hiding.
    await instance.execAsync(WEB_PRAGMAS);
    adopt(instance);
  })();
}

export { schema };
