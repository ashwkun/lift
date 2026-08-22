import { useMemo } from 'react';
import { View } from 'react-native';
import { LineChart, type lineDataItem } from 'react-native-gifted-charts';

import { useColors } from '@/theme';

export interface SparklineProps {
  /** Oldest first. Any unit. The line is scaled to its own range. */
  values: readonly number[];
  width?: number;
  height?: number;
  color?: string;
}

/** The end dot's radius, and so the inset the plot needs on every side. */
const DOT_RADIUS = 2;

// gifted-charts does not put its plot band at the top of the box it is handed.
// It pads the band by ten points, then drops the scrolling chart area by eleven
// unless the x-axis carries that thickness itself. Both numbers are constants
// inside the library rather than props, so both are cancelled here: the extra
// y-axis height gives back the eleven, and the wrapper is lifted by the ten.
// Skip either and the line floats inside the 56×22 slot instead of filling it.
const PLOT_TOP_PADDING = 10;
const AXIS_HEIGHT_MAKEUP = 11;

/**
 * A line with no axes, no labels and no scale.
 *
 * It belongs beside a figure that already states the value, and its only job is
 * the shape of the last few months. Whether the number has been climbing,
 * falling or sitting still. That is the one thing a list of current values
 * cannot show and the reason the measurements list used to need a tap per row
 * before it said anything at all.
 *
 * Because it is a redundant reading of numbers stated next to it, it is hidden
 * from screen readers: announcing "graph" fifteen times down a list adds a stop
 * at every row and no information.
 */
export function Sparkline({ values, width = 56, height = 22, color }: SparklineProps) {
  const colors = useColors();
  const stroke = color ?? colors.textSecondary;

  // The dot is drawn outwards from the last point, so the plot is inset by its
  // radius on every side and cannot be clipped at either extreme of the range.
  const plotWidth = width - DOT_RADIUS * 2;
  const plotHeight = height - DOT_RADIUS * 2;

  const data = useMemo<lineDataItem[] | null>(() => {
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;

    // The chart is told its scale runs 0..1 (`maxValue`), so normalising here is
    // what fixes each reading to a pixel. A flat series has no range to
    // normalise against; rather than divide by zero it is drawn down the middle,
    // which is the honest picture of a number that has not moved.
    return values.map((value, index) => ({
      value: span === 0 ? 0.5 : (value - min) / span,
      // Only the newest reading keeps its dot, so the eye lands on where the
      // line ended up rather than having to work out which end is now.
      hideDataPoint: index < values.length - 1,
    }));
  }, [values]);

  // Keeps the row's layout identical whether or not there is a trend to draw,
  // so a list of measurements doesn't jag left and right down its value column.
  if (!data) return <View style={{ width, height }} />;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // The whole row is one press target; the chart brings its own scroll view
      // and must not take a touch that belongs to the row.
      pointerEvents="none"
      style={{ width, height, overflow: 'hidden' }}
    >
      {/* The chart reserves room under the plot for an axis and labels it will
          never draw, so it is placed by its plot band rather than laid out. */}
      <View
        style={{
          position: 'absolute',
          left: DOT_RADIUS,
          top: DOT_RADIUS - PLOT_TOP_PADDING,
          width,
          height: height + PLOT_TOP_PADDING,
        }}
      >
        <LineChart
          data={data}
          width={plotWidth}
          height={plotHeight}
          maxValue={1}
          // One gap per interval, so the first reading sits on the left edge of
          // the plot and the newest on the right.
          spacing={plotWidth / (data.length - 1)}
          adjustToWidth
          initialSpacing={0}
          endSpacing={0}
          yAxisExtraHeight={AXIS_HEIGHT_MAKEUP}
          color={stroke}
          thickness={1.5}
          strokeLinecap="round"
          hideDataPoints={false}
          dataPointsShape="circular"
          dataPointsRadius={DOT_RADIUS}
          dataPointsColor={stroke}
          hideAxesAndRules
          hideYAxisText
          yAxisLabelWidth={0}
          yAxisThickness={0}
          xAxisThickness={0}
          disableScroll
        />
      </View>
    </View>
  );
}
