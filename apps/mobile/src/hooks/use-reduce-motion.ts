import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "reduce motion" accessibility setting is on.
 *
 * Decorative animation — confetti, spring entrances — must be skipped when this
 * is true. The information the animation decorates still has to be shown, so
 * callers drop the motion rather than the content.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
