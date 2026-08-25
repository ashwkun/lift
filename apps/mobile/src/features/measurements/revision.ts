/**
 * A counter that changes whenever the measurement log does.
 *
 * The screens that read the log refetch on focus, which is right for a table
 * that only changes when the user changes it *from one of those screens*. Two
 * things now write to it from outside that loop: the quick-add on Home, and a
 * weight typed into a notification while the app is open behind it. Neither
 * involves a navigation, so neither triggers a focus effect, and without this
 * the screen the user is looking at keeps showing yesterday's reading until
 * they navigate away and back.
 *
 * A counter rather than the rows themselves. The queries are cheap (one small
 * table), the shapes each screen wants differ, and caching the data here would
 * mean keeping a second copy of it correct. This only has to say "something
 * moved".
 */

import { create } from 'zustand';

interface MeasurementRevision {
  revision: number;
  bump: () => void;
}

export const useMeasurementRevision = create<MeasurementRevision>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/** Called by the repository after every write. Safe outside React. */
export function bumpMeasurementRevision(): void {
  useMeasurementRevision.getState().bump();
}
