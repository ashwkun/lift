/**
 * Sync status, surfaced in the UI.
 *
 * Deliberately separate from the engine: the engine is a pure async routine,
 * this is the observable state around it.
 */

import { create } from 'zustand';

import { pendingCount, runSync, SyncHttpError } from '@/features/sync/engine';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  pending: number;

  refreshPending: () => Promise<void>;
  sync: (options?: { silent?: boolean }) => Promise<void>;
  markSignedOut: () => void;
}

export const useSync = create<SyncState>((set, get) => ({
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pending: 0,

  refreshPending: async () => {
    set({ pending: await pendingCount() });
  },

  sync: async ({ silent = false } = {}) => {
    if (get().status === 'syncing') return;

    if (!silent) set({ status: 'syncing', lastError: null });

    try {
      const result = await runSync();

      set({
        status: 'idle',
        lastSyncedAt: Date.now(),
        lastError: null,
        pending: await pendingCount(),
      });

      if (result.quarantined > 0) {
        set({
          lastError: `${result.quarantined} change${
            result.quarantined === 1 ? '' : 's'
          } could not be synced and were discarded.`,
        });
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.isAuthError) {
        set({ status: 'signed-out', lastError: 'Session expired. Sign in again to sync.' });
        return;
      }

      // Anything else is most likely a dead network. Local data is untouched,
      // so this is a soft failure the user can ignore.
      set({
        status: 'offline',
        lastError: (error as Error).message,
        pending: await pendingCount(),
      });
    }
  },

  markSignedOut: () => set({ status: 'signed-out', lastSyncedAt: null, pending: 0 }),
}));
