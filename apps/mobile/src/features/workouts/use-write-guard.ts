import { useCallback, useState } from 'react';

import { haptics } from '@/features/feedback/haptics';

/**
 * Fire-and-forget writes that say so when they fail.
 *
 * Every write on the logging screen was a bare `void promise`: a disk that has
 * run out of room rejects all of them, and the user keeps lifting into a log
 * that is no longer recording. The counter is deliberately a count of lost
 * changes rather than a queue. Nothing here is worth retrying automatically,
 * because the failure is a property of the device, not of the statement.
 *
 * A success clears the count. Anything that writes at all means the disk let go.
 *
 * The settled outcome comes back so a caller that showed something optimistic
 * can take it down again: the check-off does, and every other call site ignores
 * the value. Without it a row stays green over a set the database never got,
 * one line below the banner saying the screen is not saving.
 *
 * Shared by the two screens that write sets: the live session and the editor
 * for a finished one, because they are the same screen with a different clock
 * behind it, and a second copy of this would be the one that stops reporting.
 */
export function useWriteGuard(): {
  guard: (promise: Promise<unknown>) => Promise<boolean>;
  lostWrites: number;
} {
  const [lostWrites, setLostWrites] = useState(0);

  const guard = useCallback(
    (promise: Promise<unknown>): Promise<boolean> =>
      promise.then(
        () => {
          setLostWrites(0);
          return true;
        },
        () => {
          haptics.rejected();
          setLostWrites((count) => count + 1);
          return false;
        },
      ),
    [],
  );

  return { guard, lostWrites };
}
