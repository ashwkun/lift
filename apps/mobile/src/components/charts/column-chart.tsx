import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { G, Line, Rect } from 'react-native-svg';

import { Text } from '@/components/ui';
import { spacing, useColors } from '@/theme';

export interface ColumnDatum {
  /** Stable identity for selection — the bucket's start timestamp. */
  key: number;
  label: string;
  value: number;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  width: number;
  height?: number;
  /** Formats the y-axis ticks. Keep it short — the gutter is 44px. */
  formatValue?: (value: number) => string;
  selectedKey?: number | null;
  /** Tapping the selected column again passes null, clearing the selection. */
  onSelect?: (datum: ColumnDatum | null) => void;
  color?: string;
  /** Roughly how many x-axis labels to show before thinning them out. */
  maxLabels?: number;
}

const PADDING = { top: 14, right: 6, bottom: 6, left: 46 };

/**
 * Time-bucketed column chart.
 *
 * A column rather than a line: these series are *totals per period*, and a line
 * implies a continuous value moving between samples. Two weeks at 12,000 kg
 * with an empty one between them is a gap, not a slope through 6,000.
 *
 * Bars always start at zero for the same reason — a truncated baseline makes a
 * 5% week-on-week change look like a doubling.
 */
export function ColumnChart({
  data,
  width,
  height = 190,
  formatValue = (value) => String(Math.round(value)),
  selectedKey = null,
  onSelect,
  color,
  maxLabels = 5,
}: ColumnChartProps) {
  const colors = useColors();
  const fill = color ?? colors.accent;

  const geometry = useMemo(() => {
    if (data.length === 0) return null;

    const peak = data.reduce((max, item) => Math.max(max, item.value), 0);
    const niceMax = niceCeiling(peak);

    const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom);
    const slot = plotWidth / data.length;
    // Cap the bar so a three-bucket range doesn't render three fat slabs.
    const barWidth = Math.max(3, Math.min(slot * 0.62, 34));

    const bars = data.map((item, index) => {
      const barHeight = niceMax === 0 ? 0 : (item.value / niceMax) * plotHeight;
      return {
        datum: item,
        // A non-zero value always gets a visible sliver, otherwise a light week
        // is indistinguishable from a rest week.
        height: item.value > 0 ? Math.max(2, barHeight) : 0,
        x: PADDING.left + slot * index + (slot - barWidth) / 2,
        slotX: PADDING.left + slot * index,
      };
    });

    return { bars, niceMax, plotHeight, plotWidth, barWidth, slot };
  }, [data, width, height]);

  if (!geometry) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="label" color="textTertiary">
          No data in this range
        </Text>
      </View>
    );
  }

  const { bars, niceMax, plotHeight, barWidth } = geometry;
  const baseline = PADDING.top + plotHeight;

  // Show every nth label so they never collide; always keep the last bucket,
  // which is the one the user is actually training in.
  const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));

  return (
    <View>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((fraction) => {
          const y = PADDING.top + plotHeight * fraction;
          return (
            <Line
              key={fraction}
              x1={PADDING.left}
              y1={y}
              x2={width - PADDING.right}
              y2={y}
              stroke={colors.border}
              strokeWidth={fraction === 1 ? 1 : StyleSheet.hairlineWidth * 2}
            />
          );
        })}

        {bars.map((bar) => {
          const selected = selectedKey === bar.datum.key;
          const dimmed = selectedKey !== null && !selected;

          return (
            <G key={bar.datum.key}>
              {bar.height > 0 && (
                <Rect
                  x={bar.x}
                  y={baseline - bar.height}
                  width={barWidth}
                  height={bar.height}
                  rx={Math.min(3, barWidth / 2)}
                  fill={fill}
                  opacity={dimmed ? 0.3 : 1}
                />
              )}

              {/* Full-height transparent target: a 2px bar is untappable, and
                  reaching for an empty week should still select it. */}
              {onSelect && (
                <Rect
                  x={bar.slotX}
                  y={PADDING.top}
                  width={geometry.slot}
                  height={plotHeight}
                  fill="transparent"
                  onPress={() => onSelect(selected ? null : bar.datum)}
                />
              )}
            </G>
          );
        })}
      </Svg>

      {/* Axis text lives outside the SVG so it picks up the app's font stack —
          react-native-svg's <Text> does not inherit any of it. */}
      <View
        style={[styles.yAxis, { top: PADDING.top - 7, height: plotHeight + 14 }]}
        pointerEvents="none"
      >
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {formatValue(niceMax)}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {formatValue(niceMax / 2)}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          0
        </Text>
      </View>

      <View style={styles.xAxis} pointerEvents="none">
        {data.map((item, index) => {
          const show = (data.length - 1 - index) % labelStep === 0;
          return (
            <View key={item.key} style={styles.xSlot}>
              {show && (
                <Text variant="caption" color="textTertiary" numberOfLines={1}>
                  {item.label}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Rounds an axis maximum up to a readable step (1, 2, 2.5 or 5 × 10ⁿ).
 *
 * Without this the top gridline reads "13,847 kg", which nobody parses at a
 * glance — and the half-way tick inherits the same problem.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;

  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  yAxis: {
    position: 'absolute',
    left: 0,
    width: PADDING.left - spacing.sm,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  xAxis: {
    flexDirection: 'row',
    paddingLeft: PADDING.left,
    paddingRight: PADDING.right,
    marginTop: spacing.xs,
  },
  xSlot: { flex: 1, alignItems: 'center' },
});
