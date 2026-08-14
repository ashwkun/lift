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
 */

import { create } from 'zustand';

interface ExercisePickerState {
  /** Ids awaiting collection, in the order the user tapped them. */
  pending: string[];
  /** Called by the picker just before it dismisses. */
  submit: (ids: string[]) => void;
  /** Called by the caller once it has written the rows. */
  clear: () => void;
}

export const useExercisePicker = create<ExercisePickerState>((set) => ({
  pending: [],
  submit: (ids) => set({ pending: ids }),
  clear: () => set({ pending: [] }),
}));
