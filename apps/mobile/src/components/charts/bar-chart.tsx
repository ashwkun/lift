import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  /** Renders horizontal bars with the label on the left. */
  horizontal?: boolean;
  height?: number;
}

/**
 * Proportional bar chart.
 *
 * Built from plain Views rather than SVG — bars are just rectangles, and this
 * way they inherit theme colours and text styles with no extra plumbing.
 */
export function BarChart({
  data,
  formatValue = (value) => String(Math.round(value)),
  horizontal = true,
  height = 140,
}: BarChartProps) {
  const colors = useColors();
  const max = data.reduce((peak, item) => Math.max(peak, item.value), 0);

  if (data.length === 0 || max === 0) {
    return (
      <View style={[styles.empty, { height: horizontal ? undefined : height }]}>
        <Text variant="label" color="textTertiary">
          No data yet
        </Text>
      </View>
    );
  }

  if (horizontal) {
    return (
      <View style={styles.horizontalContainer}>
        {data.map((item) => (
          <View key={item.label} style={styles.horizontalRow}>
            <Text variant="label" color="textSecondary" numberOfLines={1} style={styles.hLabel}>
              {item.label}
            </Text>
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: item.color ?? colors.accent,
                    // Guarantee a sliver of bar for tiny non-zero values so the
                    // row doesn't look empty.
                    width: `${Math.max(2, (item.value / max) * 100)}%`,
                  },
                ]}
              />
            </View>
            <Text variant="label" style={styles.hValue}>
              {formatValue(item.value)}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.verticalContainer, { height }]}>
      {data.map((item) => (
        <View key={item.label} style={styles.verticalColumn}>
          <View style={styles.verticalTrack}>
            <View
              style={[
                styles.verticalFill,
                {
                  backgroundColor: item.color ?? colors.accent,
                  height: `${Math.max(2, (item.value / max) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  horizontalContainer: { gap: spacing.sm },
  horizontalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hLabel: { width: 88 },
  hValue: { width: 62, textAlign: 'right' },
  track: { flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  verticalContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  verticalColumn: { flex: 1, alignItems: 'center', gap: spacing.xs, height: '100%' },
  verticalTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  verticalFill: { width: '100%', borderRadius: radius.sm, minHeight: 2 },
});
