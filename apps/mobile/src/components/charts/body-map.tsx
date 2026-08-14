import type { MuscleGroup } from '@lift/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui';
import {
  DEFAULT_VOLUME_THRESHOLDS,
  volumeColor,
  type VolumeThresholds,
} from '@/features/analytics/volume-landmarks';
import { spacing, useColors } from '@/theme';

import {
  BACK_PATHS,
  BODY_VIEW_HEIGHT,
  BODY_VIEW_WIDTH,
  FRONT_PATHS,
  type BodyMapPaths,
} from './body-map-paths';

const ASPECT = BODY_VIEW_HEIGHT / BODY_VIEW_WIDTH;

/**
 * Muscles the figures have no shape for, drawn onto the nearest region instead.
 *
 * The art has no upper-back or abductor outline of its own, and leaving those
 * regions cold would read as "you never trained your back" to anyone doing rows.
 * Their sets are added to the region that physically overlaps them, so the
 * colour reflects everything that worked that area.
 */
const REGION_ALIASES: Partial<Record<MuscleGroup, MuscleGroup>> = {
  upper_back: 'lats',
  abductors: 'glutes',
};

/** Muscles with no place on either figure — they still appear in the list. */
export const UNMAPPED_MUSCLES: readonly MuscleGroup[] = ['cardio', 'full_body', 'other'];

export interface BodyMapProps {
  /** Weekly working sets per muscle. Anything missing renders untrained. */
  setsPerWeek: Partial<Record<MuscleGroup, number>>;
  /** Total width for both figures, including the gap between them. */
  width: number;
  /**
   * Ceiling on figure height. Half a phone's width at this aspect ratio is
   * ~345pt per figure, which pushes the breakdown list off screen entirely;
   * the figures narrow rather than stretch.
   */
  maxHeight?: number;
  thresholds?: VolumeThresholds;
  selected?: MuscleGroup | null;
  onSelect?: (muscle: MuscleGroup | null) => void;
}

/**
 * Front and back muscle heatmap over anatomical outlines.
 *
 * Colour is absolute, not relative: it comes from where a muscle's weekly sets
 * fall against the volume landmarks, so an undertrained muscle stays dim even
 * when it is the most-trained thing you did that month, and an overreached one
 * leaves the accent hue entirely rather than just getting brighter.
 */
export function BodyMap({
  setsPerWeek,
  width,
  maxHeight = 300,
  thresholds = DEFAULT_VOLUME_THRESHOLDS,
  selected = null,
  onSelect,
}: BodyMapProps) {
  const figureHeight = Math.min(((width - spacing.md) / 2) * ASPECT, maxHeight);
  const figureWidth = figureHeight / ASPECT;

  // Resolved once for both figures so the two sides cannot disagree about what
  // an aliased muscle contributes.
  const regionSets = resolveRegions(setsPerWeek);

  return (
    <View style={styles.row}>
      <Figure
        title="Front"
        paths={FRONT_PATHS}
        width={figureWidth}
        height={figureHeight}
        regionSets={regionSets}
        thresholds={thresholds}
        selected={selected}
        onSelect={onSelect}
      />
      <Figure
        title="Back"
        paths={BACK_PATHS}
        width={figureWidth}
        height={figureHeight}
        regionSets={regionSets}
        thresholds={thresholds}
        selected={selected}
        onSelect={onSelect}
      />
    </View>
  );
}

/** Folds aliased muscles into the region that stands in for them. */
function resolveRegions(
  setsPerWeek: Partial<Record<MuscleGroup, number>>,
): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const [muscle, sets] of Object.entries(setsPerWeek) as [MuscleGroup, number][]) {
    if (!sets) continue;
    const region = REGION_ALIASES[muscle] ?? muscle;
    out[region] = (out[region] ?? 0) + sets;
  }
  return out;
}

function Figure({
  title,
  paths,
  width,
  height,
  regionSets,
  thresholds,
  selected,
  onSelect,
}: {
  title: string;
  paths: BodyMapPaths;
  width: number;
  height: number;
  regionSets: Partial<Record<MuscleGroup, number>>;
  thresholds: VolumeThresholds;
  selected: MuscleGroup | null;
  onSelect?: (muscle: MuscleGroup | null) => void;
}) {
  const colors = useColors();
  // Selecting an aliased muscle lights up the region standing in for it.
  const selectedRegion = selected ? (REGION_ALIASES[selected] ?? selected) : null;

  return (
    <View style={styles.figure}>
      <Svg width={width} height={height} viewBox={`0 0 ${BODY_VIEW_WIDTH} ${BODY_VIEW_HEIGHT}`}>
        {(Object.entries(paths) as [MuscleGroup, string[]][]).map(([muscle, ds]) => {
          const sets = regionSets[muscle] ?? 0;
          // A selected muscle keeps its heat colour and gains an outline —
          // repainting it would hide the one value the tap was asking about.
          const isSelected = selectedRegion === muscle;
          const fill = volumeColor(sets, colors, thresholds);

          return ds.map((d, index) => (
            <Path
              key={`${muscle}-${index}`}
              d={d}
              fill={fill}
              stroke={isSelected ? colors.text : colors.border}
              strokeWidth={isSelected ? 4 : 1}
              onPress={onSelect ? () => onSelect(isSelected ? null : muscle) : undefined}
            />
          ));
        })}
      </Svg>

      <Text variant="caption" color="textTertiary">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  figure: { alignItems: 'center', gap: spacing.xs },
});
