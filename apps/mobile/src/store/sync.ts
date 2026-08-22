/**
 * Sync status, surfaced in the UI.
 *
 * Deliberately separate from the engine: the engine is a pure async routine,
 * this is the observable state around it.
 */

import { create } from 'zustand';

import { readOutbox, runSync, SyncHttpError } from '@/features/sync/engine';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Changes on their way to the server. */
  pending: number;
  /** Changes the server will not take. Held separately so nothing can round
   *  them down into "synced". */
  rejected: number;
  rejectionReason: string | null;

  refreshPending: () => Promise<void>;
  sync: (options?: { silent?: boolean }) => Promise<void>;
  markSignedOut: () => void;
}

export const useSync = create<SyncState>((set, get) => ({
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pending: 0,
  rejected: 0,
  rejectionReason: null,

  refreshPending: async () => {
    set(await readOutbox());
  },

  sync: async ({ silent = false } = {}) => {
    if (get().status === 'syncing') return;

    if (!silent) set({ status: 'syncing', lastError: null });

    try {
      await runSync();

      set({
        status: 'idle',
        lastSyncedAt: Date.now(),
        lastError: null,
        // A run can finish cleanly and still leave changes the server refused,
        // so the counts come from the log rather than from the run's totals.
        ...(await readOutbox()),
      });
    } catch (error) {
      if (error instanceof SyncHttpError && error.isAuthError) {
        set({ status: 'signed-out', lastError: 'Session expired. Sign in again to sync.' });
        return;
      }

      /*
       * Logged before it is swallowed into state.
       *
       * Everything below turns the error into one line for the card, which is
       * all the UI has room for, and for a while that was the only trace it
       * left anywhere. A failure with no stack in the log reads as the app
       * doing nothing at all when sync is tapped, so the one place with the
       * real message says it out loud.
       */
      console.error('[sync] run failed', error);

      /*
       * A dead network is retried on its own and the user can ignore it. A
       * database failure will not fix itself, so it is not filed as 'offline'.
       * "will retry" is a promise this one cannot keep. Local data is
       * untouched either way.
       */
      set({
        status: isDatabaseError(error) ? 'error' : 'offline',
        lastError: describeFailure(error),
        ...(await readOutbox()),
      });
    }
  },

  // Sign-out clears the oplog, so the queue is genuinely empty afterwards.
  markSignedOut: () =>
    set({
      status: 'signed-out',
      lastSyncedAt: null,
      pending: 0,
      rejected: 0,
      rejectionReason: null,
    }),
}));

/**
 * Describes a failed run in terms the user can do something with.
 *
 * The raw text is either a transport message ("Network request failed"), the
 * server's response body, or SQLite's, and none is worth reading. The part that
 * matters is the part the error doesn't say: the local database was not touched.
 *
 * The database case is listed separately because collapsing it into the network
 * one is actively misleading. A constraint violation while applying a pull used
 * to report "No connection to the server" against a server that was answering
 * perfectly, which sends anyone debugging it to the wrong machine entirely.
 */
function describeFailure(error: unknown): string {
  if (error instanceof SyncHttpError) {
    return `The server returned an error (${error.status}). Your workouts are still here.`;
  }

  if (isDatabaseError(error)) {
    return 'This device could not store the changes. Your workouts are still here.';
  }

  return 'No connection to the server. Your workouts are still here.';
}

/**
 * Whether a failure came from SQLite rather than from the network.
 *
 * Matched on the message because that is all there is: expo-sqlite rejects with
 * a plain `Error`, so there is no class to test against.
 */
function isDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /constraint failed|SQLITE_|database is locked|no such (table|column)/i.test(message);
}
