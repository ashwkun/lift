import { DEFAULT_TRAINING_LEVEL, landmarksFor, type TrainingLevel } from '@lift/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { spacing, stroke, useColors } from '@/theme';

import { legendSamples, volumeColor } from './volume-landmarks';

export interface VolumeLegendProps {
  level?: TrainingLevel;
  /** Adds the hairline rule above, for a legend sitting under a body map. */
  ruled?: boolean;
}

/**
 * The body map's key: the same ramp, sampled at its own landmarks.
 *
 * Built from `legendSamples` rather than from evenly spaced fractions, so the
 * swatches step where the colour actually steps. A legend that sampled 0–100%
 * linearly would show a smooth gradient for a ramp that deliberately is not
 * one — most of its movement happens between MEV and MAV.
 *
 * The map colours 21 muscles against 21 different set counts, so this can no
 * longer quote one. It shows the *shape* of the ramp, which every muscle shares,
 * sampled on chest because it sits in the middle of the table — and the caption
 * says whose numbers each figure is being held to instead of naming a range that
 * would be wrong for two thirds of the body.
 */
export function VolumeLegend({ level = DEFAULT_TRAINING_LEVEL, ruled = true }: VolumeLegendProps) {
  const colors = useColors();
  const landmarks = landmarksFor('chest', level);

  return (
    <View style={styles.wrapper}>
      <View
        accessible
        accessibilityLabel="Colour scale, from undertrained through the productive range to overreaching"
        style={[
          styles.legend,
          ruled && { paddingTop: spacing.md, borderTopWidth: stroke.rule, borderTopColor: colors.border },
        ]}
      >
        <Text variant="caption" color="textTertiary">
          Under
        </Text>
        <View style={styles.swatches}>
          {legendSamples(landmarks).map((sets) => (
            <View
              key={sets}
              style={[styles.swatch, { backgroundColor: volumeColor(sets, colors, landmarks) }]}
            />
          ))}
        </View>
        <Text variant="caption" color="textTertiary">
          Over
        </Text>
      </View>

      <Text variant="caption" color="textTertiary" align="center">
        Weekly sets, against the target range for each muscle
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  swatches: { flexDirection: 'row', gap: 3 },
  swatch: { width: 18, height: 8, borderRadius: 2 },
});
