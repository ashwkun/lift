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

      // Anything else is most likely a dead network. Local data is untouched,
      // so this is a soft failure the user can ignore.
      set({
        status: 'offline',
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
 * The raw text is either a transport message ("Network request failed") or the
 * server's response body, and neither is worth reading. The part that matters
 * is the part the error doesn't say: the local database was not touched.
 */
function describeFailure(error: unknown): string {
  if (error instanceof SyncHttpError) {
    return `The server returned an error (${error.status}). Your workouts are still here.`;
  }

  return 'No connection to the server. Your workouts are still here.';
}
