import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { spacing, stroke, useColors } from '@/theme';

import {
  DEFAULT_VOLUME_THRESHOLDS,
  legendSamples,
  volumeColor,
  type VolumeThresholds,
} from './volume-landmarks';

export interface VolumeLegendProps {
  thresholds?: VolumeThresholds;
  /** Adds the hairline rule above, for a legend sitting under a body map. */
  ruled?: boolean;
}

/**
 * The body map's key: the same ramp, sampled at its own landmarks.
 *
 * Built from `legendSamples` rather than from evenly spaced fractions, so the
 * swatches step where the colour actually steps. A legend that sampled 0–100%
 * linearly would show a smooth gradient for a ramp that deliberately is not
 * one — most of its movement happens between MEV and MRV.
 */
export function VolumeLegend({ thresholds = DEFAULT_VOLUME_THRESHOLDS, ruled = true }: VolumeLegendProps) {
  const colors = useColors();

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
          {legendSamples(thresholds).map((sets) => (
            <View
              key={sets}
              style={[styles.swatch, { backgroundColor: volumeColor(sets, colors, thresholds) }]}
            />
          ))}
        </View>
        <Text variant="caption" color="textTertiary">
          Over
        </Text>
      </View>

      <Text variant="caption" color="textTertiary" align="center">
        Weekly sets against a {thresholds.mev}–{thresholds.mrv} set target
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
