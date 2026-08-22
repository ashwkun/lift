import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

import { radius } from '@/theme';

/**
 * Deterministic PRNG (mulberry32), seeded from the run key.
 *
 * `Math.random` would be an impure call during render, which the React Compiler
 * rejects, and rightly: a re-render mid-fall would re-roll every particle and
 * make them jump. Seeding from `runKey` keeps generation a pure function of the
 * props, so a given burst is identical however many times it re-renders, while
 * successive bursts still look different.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  startX: number;
  endX: number;
  swayX: number;
  width: number;
  height: number;
  color: string;
  /** Fraction of the run elapsed before this particle starts falling. */
  delay: number;
  rotations: number;
  round: boolean;
}

export interface ConfettiProps {
  /** Changing this restarts the burst. Reuse the same value to leave it alone. */
  runKey: number;
  colors: readonly string[];
  count?: number;
  durationMs?: number;
}

/**
 * A falling-confetti burst.
 *
 * Built on React Native's own `Animated` rather than Reanimated: the whole
 * effect is transform and opacity, which `useNativeDriver` already runs on the
 * UI thread, and nothing else in the app has needed Reanimated's worklet
 * toolchain yet.
 *
 * One shared driver animates 0 → 1 and every particle interpolates off it, so
 * forty particles cost one animation rather than forty. Per-particle stagger
 * comes from starting each one's input range at its own `delay` instead of from
 * separate timers.
 */
export function Confetti({ runKey, colors, count = 44, durationMs = 2600 }: ConfettiProps) {
  const { width, height } = useWindowDimensions();
  // Lazy initialiser rather than a ref: the driver must survive re-renders, and
  // reading `ref.current` during render is exactly what the compiler forbids.
  const [progress] = useState(() => new Animated.Value(0));

  const particles = useMemo<Particle[]>(() => {
    const random = seededRandom(runKey * 2654435761);

    return Array.from({ length: count }, (): Particle => {
      const startX = random() * width;
      return {
        startX,
        // Drift outward from wherever it started, so the fall fans out rather
        // than dropping in parallel lines.
        endX: startX + (random() - 0.5) * width * 0.5,
        swayX: startX + (random() - 0.5) * width * 0.35,
        width: 6 + random() * 6,
        height: 9 + random() * 7,
        color: colors[Math.floor(random() * colors.length)]!,
        // Capped below 0.7 so the opacity keyframes below stay ordered.
        delay: random() * 0.35,
        rotations: 1 + random() * 3,
        round: random() < 0.25,
      };
    });
  }, [runKey, count, width, colors]);

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [runKey, durationMs, progress]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((particle, index) => {
        const fall = [particle.delay, 1];

        return (
          <Animated.View
            key={index}
            style={[
              styles.particle,
              {
                width: particle.width,
                height: particle.height,
                backgroundColor: particle.color,
                borderRadius: particle.round ? particle.width : radius.sm / 2,
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: fall,
                      outputRange: [-40, height + 60],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    translateX: progress.interpolate({
                      inputRange: [particle.delay, (particle.delay + 1) / 2, 1],
                      outputRange: [particle.startX, particle.swayX, particle.endX],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: fall,
                      outputRange: ['0deg', `${particle.rotations * 360}deg`],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
                opacity: progress.interpolate({
                  inputRange: [particle.delay, particle.delay + 0.05, 0.78, 1],
                  outputRange: [0, 1, 1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Positioned from the origin and moved entirely by transform, so the whole
  // animation qualifies for the native driver.
  particle: { position: 'absolute', top: 0, left: 0 },
});
