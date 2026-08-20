/**
 * Hand-off channel between the exercise picker and whoever opened it.
 *
 * The picker used to return its selection by calling `router.back()` and then
 * `router.setParams(...)`. `setParams` writes to whichever route is focused at
 * the moment it runs, and after a `back()` that is a race: often the params
 * landed on the picker itself as it was being popped, and the caller's effect
 * never fired, so nothing was added.
 *
 * A store sidesteps the race entirely, and keeps the property that made the
 * original design right — the picker still doesn't know or care whether it was
 * opened by a routine editor or a live workout.
 *
 * That ignorance is why the delivery is addressed on the *opener's* side rather
 * than by a route param. A bare list of pending ids is broadcast: with a live
 * workout and a routine editor both on the stack, both read `pending` on the
 * next render and the exercises land in two places at once. The opener stamps
 * the channel with its own name before navigating, the consumer reads only
 * deliveries addressed to it, and the picker still carries nothing about its
 * caller.
 */

import { useMemo } from 'react';
import { create } from 'zustand';

/**
 * Who asked. Free-form on purpose — a screen with instances (a routine editor
 * per routine id) addresses itself as `routine:${id}` so returning to a
 * *different* routine can't collect a delivery meant for the one you left.
 */
export type PickerRequester = string;

interface ExercisePickerState {
  /** Which opener the pending ids belong to; null when nothing is in flight. */
  requestedBy: PickerRequester | null;
  /** Ids awaiting collection, in the order the user tapped them. */
  pending: string[];
  /** Called by the opener immediately before it navigates to the picker. */
  open: (requestedBy: PickerRequester) => void;
  /** Called by the picker just before it dismisses. */
  submit: (ids: string[]) => void;
  /** Called by the addressee once it has written the rows. */
  clear: (requestedBy: PickerRequester) => void;
}

const NO_IDS: string[] = [];

export const useExercisePicker = create<ExercisePickerState>((set) => ({
  requestedBy: null,
  pending: [],
  // Opening also drops anything uncollected. A previous delivery can only still
  // be sitting here if its addressee was unmounted before it read the channel,
  // and handing those ids to the next opener would be the exact misdelivery the
  // addressee exists to prevent.
  open: (requestedBy) => set({ requestedBy, pending: [] }),
  submit: (ids) => set({ pending: ids }),
  clear: (requestedBy) =>
    set((state) => (state.requestedBy === requestedBy ? { requestedBy: null, pending: [] } : state)),
}));

/**
 * The ids waiting for `requestedBy`, or an empty array for everyone else.
 *
 * The empty case returns one shared array rather than a fresh `[]`, so a screen
 * that lists this in an effect's dependencies doesn't re-run it on every store
 * change that isn't addressed to it.
 */
export function usePickedExercises(requestedBy: PickerRequester): string[] {
  const pending = useExercisePicker((state) => state.pending);
  const addressee = useExercisePicker((state) => state.requestedBy);

  return useMemo(
    () => (addressee === requestedBy ? pending : NO_IDS),
    [addressee, pending, requestedBy],
  );
}
