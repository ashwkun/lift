/**
 * Puts a list back at its first row when the thing it is listing changes.
 *
 * A list keeps its scroll offset across a data change, which is right when the
 * data is the same list with a row added and wrong when it is a different list
 * entirely. Searching the exercise catalog is the second case: scroll a
 * thousand rows into the library, type "squat", and the offset is still a
 * thousand rows down while the results are a few dozen long, so the screen
 * lands mid-list or clamped to the bottom on whatever the last few matches
 * happen to be. The results are correct and invisible, which reads as the
 * search having returned the wrong thing.
 *
 * Keyed off the *applied* query rather than the raw field, so the jump happens
 * on the same frame the rows change rather than one debounce ahead of them.
 *
 * Skips the first run: a list that has never been scrolled is already at the
 * top, and scrolling it there on mount fights whatever restored position a
 * navigator is trying to hand it.
 */

import { useEffect, useRef } from 'react';

interface Scrollable {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
}

export function useScrollToTopOn(
  ref: React.RefObject<Scrollable | null>,
  key: string,
): void {
  const previous = useRef(key);

  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;

    // Never animated. This is not a movement the user asked for, and gliding a
    // thousand rows back up would take longer than reading the results does.
    ref.current?.scrollToOffset({ offset: 0, animated: false });
  }, [ref, key]);
}
