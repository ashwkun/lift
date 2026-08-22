import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useSync } from '@/store/sync';

import { useSession } from './auth-client';

/** Don't re-sync on every brief app switch. */
const MIN_INTERVAL_MS = 30_000;

/**
 * Kicks off background syncs at the moments that matter: app start, and
 * returning to the foreground.
 *
 * Every run is silent. A failed sync must never interrupt someone mid-workout,
 * because the local database is the source of truth and nothing is lost.
 * Explicit "Sync Now" is the only path that surfaces errors directly.
 */
export function useSyncTriggers(): void {
  const { data: session } = useSession();
  const sync = useSync((state) => state.sync);
  const refreshPending = useSync((state) => state.refreshPending);

  const lastRunRef = useRef(0);
  const signedIn = Boolean(session?.user);

  useEffect(() => {
    if (!signedIn) return;

    const run = () => {
      const now = Date.now();
      if (now - lastRunRef.current < MIN_INTERVAL_MS) return;
      lastRunRef.current = now;
      void sync({ silent: true });
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });

    return () => subscription.remove();
  }, [signedIn, sync]);

  // Keep the pending badge honest even while signed out, so the user can see
  // work is queued before they ever create an account.
  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);
}
