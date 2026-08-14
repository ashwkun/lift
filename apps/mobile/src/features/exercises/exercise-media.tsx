import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme';

import { initialsFor } from './exercise-thumbnail';

export interface ExerciseMediaProps {
  name: string;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
}

/**
 * The demonstration panel at the top of an exercise's detail screen.
 *
 * The still is shown first and the clip is only fetched once tapped. The
 * catalog's clips are 300–450KB each; autoplaying one on every screen open
 * would spend a few hundred KB of someone's mobile data to answer a question
 * the still usually already answers.
 */
export function ExerciseMedia({ name, thumbnailUrl, videoUrl }: ExerciseMediaProps) {
  const colors = useColors();
  const [playing, setPlaying] = useState(false);

  // Hooks cannot be conditional, so the player is always created and simply
  // holds a null source until the user asks for the clip.
  const player = useVideoPlayer(playing && videoUrl ? videoUrl : null, (instance) => {
    // Short silent demo loops — looping is the expected behaviour, and there is
    // no audio track to interrupt whatever the user is listening to.
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  if (playing && videoUrl) {
    return (
      <View style={[styles.frame, { backgroundColor: colors.mediaPlate }]}>
        <VideoView
          player={player}
          style={styles.fill}
          contentFit="contain"
          nativeControls
          fullscreenOptions={{ enable: true }}
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole={videoUrl ? 'button' : 'image'}
      accessibilityLabel={videoUrl ? `Play ${name} demonstration` : name}
      disabled={!videoUrl}
      onPress={() => setPlaying(true)}
      style={[styles.frame, { backgroundColor: colors.mediaPlate }]}
    >
      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.fill}
          contentFit="contain"
          cachePolicy="disk"
          transition={160}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.fallback}>
          <Text variant="display" style={{ color: colors.textTertiary }}>
            {initialsFor(name)}
          </Text>
        </View>
      )}

      {videoUrl && (
        <View style={styles.playBadge}>
          <View style={[styles.playCircle, { backgroundColor: colors.overlay }]}>
            <Ionicons name="play" size={26} color="#FFFFFF" style={styles.playGlyph} />
          </View>
          <Text variant="caption" style={styles.playLabel}>
            Watch demo
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    // 4:3 suits the source artwork, which is squarish and centred; 16:9 would
    // letterbox every figure with plate on both sides.
    aspectRatio: 4 / 3,
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', alignItems: 'center', gap: spacing.sm },
  playCircle: {
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The glyph is optically left-heavy inside a circle; a nudge right centres it.
  playGlyph: { marginLeft: 3 },
  playLabel: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});
