import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui';
import { radius, useColors } from '@/theme';

/**
 * Two initials derived from the exercise name. Used when the catalog has no
 * artwork for a row (~6% of it) and for user-created exercises, which never
 * have any. Skips the parenthesised equipment qualifier so "Bench Press
 * (Barbell)" reads "BP", not "BB".
 */
export function initialsFor(name: string): string {
  const base = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export interface ExerciseThumbnailProps {
  name: string;
  url?: string | null;
  size?: number;
  /** Highlights the tile, for selected rows in a picker. */
  selected?: boolean;
  style?: ViewStyle;
}

export function ExerciseThumbnail({
  name,
  url,
  size = 44,
  selected = false,
  style,
}: ExerciseThumbnailProps) {
  const colors = useColors();

  const background = selected
    ? colors.accent
    : url
      ? colors.mediaPlate
      : colors.surfaceMuted;

  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius.md, backgroundColor: background },
        style,
      ]}
    >
      {url && !selected ? (
        <Image
          source={{ uri: url }}
          style={styles.image}
          // `contain`, not `cover`: these are full-body figures, and cropping
          // one to a square tile reliably cuts off the head or the barbell.
          contentFit="contain"
          // Disk-cached by expo-image, so a scroll back up the list is free
          // and the second launch does not re-fetch 6,800 thumbnails.
          cachePolicy="disk"
          transition={120}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          variant="label"
          style={{ color: selected ? colors.textOnAccent : colors.textSecondary }}
        >
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
