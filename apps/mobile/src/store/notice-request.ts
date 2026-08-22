/**
 * What the notification asks the active workout screen to do.
 *
 * There is exactly one such request, and it is "tick the next set".
 *
 * The rest-timer buttons are not here, because they do not need to be: a rest
 * period is a number in `./timer`, and `+15s`, `Pause` and `Skip` are complete
 * descriptions of what to do to it from anywhere. Completing a set is not.
 * `handleToggleSet` in `app/workout/active.tsx` commits the ghosted weights the
 * user was looking at, asks `canLogSet` whether the tap is allowed at all, and
 * scales the rest that follows to the kind of set it was: reading state that
 * only that screen holds. Re-deriving it next to the notification would be a
 * second implementation of the subtlest logic in the app, and the two would
 * disagree.
 *
 * So the notification raises a flag and the screen, which owns the answer, acts
 * on it. If the screen is not mounted the flag simply waits; it is cleared with
 * the notification, so it can never carry into the next session.
 *
 * A flag rather than a count on purpose. Pressing "Complete set" three times
 * because nothing seemed to happen means one set, not three, and the cost of
 * being wrong in that direction is a set the user has to untick.
 */

import { create } from 'zustand';

interface NoticeRequestState {
  completeSet: boolean;
  requestCompleteSet: () => void;
  /** Returns whether a request was outstanding, and clears it. */
  takeCompleteSet: () => boolean;
  clear: () => void;
}

export const useNoticeRequest = create<NoticeRequestState>((set, get) => ({
  completeSet: false,

  requestCompleteSet: () => set({ completeSet: true }),

  takeCompleteSet: () => {
    if (!get().completeSet) return false;
    set({ completeSet: false });
    return true;
  },

  clear: () => set({ completeSet: false }),
}));
