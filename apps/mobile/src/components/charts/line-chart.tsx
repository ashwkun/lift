import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { Text } from '@/components/ui';
import { spacing, useColors } from '@/theme';

export interface DataPoint {
  /** Epoch ms, or any monotonic numeric axis. */
  x: number;
  y: number;
}

export interface LineChartProps {
  data: DataPoint[];
  height?: number;
  width: number;
  /** Formats the y-axis labels and the value readout. */
  formatValue?: (value: number) => string;
  formatLabel?: (x: number) => string;
  color?: string;
  /** Fills the area under the line with a fading gradient. */
  filled?: boolean;
  showDots?: boolean;
}

const PADDING = { top: 12, right: 8, bottom: 22, left: 44 };

/**
 * Minimal time-series line chart.
 *
 * Hand-rolled on react-native-svg rather than pulling in a charting library:
 * the app needs exactly this one shape, and the alternatives either bundle Skia
 * (heavy) or impose their own theming.
 */
export function LineChart({
  data,
  width,
  height = 180,
  formatValue = (value) => String(Math.round(value)),
  formatLabel,
  color,
  filled = true,
  showDots = true,
}: LineChartProps) {
  const colors = useColors();
  const stroke = color ?? colors.accent;

  const geometry = useMemo(() => {
    if (data.length === 0) return null;

    const sorted = [...data].sort((a, b) => a.x - b.x);

    const xs = sorted.map((point) => point.x);
    const ys = sorted.map((point) => point.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // A flat series (every value identical) would divide by zero when scaling.
    // Pad the range so the line renders centred instead of collapsing.
    if (minY === maxY) {
      const pad = Math.abs(minY) * 0.1 || 1;
      minY -= pad;
      maxY += pad;
    }

    const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom);

    const scaleX = (x: number) =>
      PADDING.left + (maxX === minX ? plotWidth / 2 : ((x - minX) / (maxX - minX)) * plotWidth);

    const scaleY = (y: number) =>
      PADDING.top + plotHeight - ((y - minY) / (maxY - minY)) * plotHeight;

    const points = sorted.map((point) => ({
      cx: scaleX(point.x),
      cy: scaleY(point.y),
      raw: point,
    }));

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.cx},${point.cy}`)
      .join(' ');

    const areaPath =
      points.length > 1
        ? `${linePath} L${points[points.length - 1]!.cx},${PADDING.top + plotHeight} L${
            points[0]!.cx
          },${PADDING.top + plotHeight} Z`
        : '';

    return { points, linePath, areaPath, minY, maxY, plotHeight, sorted };
  }, [data, width, height]);

  if (!geometry) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="label" color="textTertiary">
          Not enough data yet
        </Text>
      </View>
    );
  }

  const { points, linePath, areaPath, minY, maxY } = geometry;
  const midY = (minY + maxY) / 2;

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Horizontal guides at min / mid / max */}
        {[maxY, midY, minY].map((value, index) => {
          const y = PADDING.top + (index / 2) * (height - PADDING.top - PADDING.bottom);
          return (
            <Line
              key={value}
              x1={PADDING.left}
              y1={y}
              x2={width - PADDING.right}
              y2={y}
              stroke={colors.border}
              strokeWidth={StyleSheet.hairlineWidth * 2}
            />
          );
        })}

        {filled && areaPath ? <Path d={areaPath} fill="url(#area)" /> : null}

        <Path
          d={linePath}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {showDots &&
          points.map((point) => (
            <Circle
              key={point.raw.x}
              cx={point.cx}
              cy={point.cy}
              r={3}
              fill={colors.background}
              stroke={stroke}
              strokeWidth={2}
            />
          ))}
      </Svg>

      {/* Axis labels sit outside the SVG so they inherit app typography. */}
      <View style={[styles.yAxis, { height: height - PADDING.bottom }]} pointerEvents="none">
        <Text variant="caption" color="textTertiary">
          {formatValue(maxY)}
        </Text>
        <Text variant="caption" color="textTertiary">
          {formatValue(minY)}
        </Text>
      </View>

      {formatLabel && points.length > 1 && (
        <View style={styles.xAxis}>
          <Text variant="caption" color="textTertiary">
            {formatLabel(points[0]!.raw.x)}
          </Text>
          <Text variant="caption" color="textTertiary">
            {formatLabel(points[points.length - 1]!.raw.x)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  yAxis: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PADDING.left - spacing.xs,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: PADDING.left,
    paddingRight: PADDING.right,
    marginTop: -spacing.md,
  },
});
