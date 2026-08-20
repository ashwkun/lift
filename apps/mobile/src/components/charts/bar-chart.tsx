import { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { BarChart as GiftedBarChart, type barDataItem } from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { radius, spacing, stroke, useColors } from '@/theme';

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

/** Thickness of a horizontal bar, and the pitch of one row around it. */
const BAR_THICKNESS = 10;
const ROW_GAP = spacing.lg;
const ROW_HEIGHT = BAR_THICKNESS + ROW_GAP;

/** The left-hand label column in the horizontal layout, and its gutter. */
const LABEL_COLUMN = 88;
const LABEL_GAP = spacing.sm;

/** The formatted value printed past the end of each horizontal bar. */
const VALUE_COLUMN = 56;
const VALUE_GAP = spacing.sm;

/**
 * The strip the library draws an axis label into: one line at the 18px it
 * hard-codes per line. Both layouts are told this explicitly so the space each
 * one reserves and the space the library actually uses cannot drift apart.
 */
const LABEL_STRIP = 18;
/** The 6px the library leaves between the baseline and that strip. */
const LABEL_GUTTER = 6;
/** Total band below the baseline that the vertical layout's captions occupy. */
const CAPTION_BAND = LABEL_GUTTER + LABEL_STRIP;

/**
 * Floor for a bar's fill, as a fraction of the plot.
 *
 * A body part with one logged set is not the same as one with none, and at true
 * proportion against a 40-set peak it would round away to nothing.
 */
const MIN_FILL = 0.02;

/**
 * How much room the library leaves below the baseline for axis labels before it
 * starts clipping them, and how far past the plot's maximum it leaves for top
 * labels. Both are extended by props (`labelsExtraHeight`, `yAxisExtraHeight`)
 * because the label column and the trailing value are wider than the default.
 */
const LIBRARY_LABEL_ALLOWANCE = 60;
const LABEL_BAND = LABEL_COLUMN + LABEL_GAP + spacing.xs;
const LABEL_HEADROOM = Math.max(0, LABEL_BAND - LIBRARY_LABEL_ALLOWANCE);
const VALUE_HEADROOM = VALUE_GAP + VALUE_COLUMN;

/**
 * Where gifted-charts lands a horizontal chart inside its own layout box.
 *
 * A horizontal `BarChart` is the vertical one rotated 90°, and the library
 * corrects for the rotation with a fixed offset folded into that transform.
 * These two numbers are that offset — the distance from the top-left of the
 * chart's layout box to the origin of the first bar — and `shiftX`/`shiftY`,
 * the library's own escape hatch, then move the origin to where this component
 * wants it. They describe the library rather than the design, so they are the
 * first thing to re-measure if an upgrade moves the chart bodily.
 */
const ROTATED_ORIGIN_X = 65;
const ROTATED_ORIGIN_Y = 27;

/**
 * The label box is positioned in the pre-rotation frame but drawn in the
 * post-rotation one, so its width and height swap roles: the library centres a
 * `labelWidth`-wide box on the bar, and after the rotation that centring is off
 * by half the difference between the label column and the bar's thickness.
 * `LABEL_RECENTRE` takes it back; `LABEL_DISTANCE` then pushes the whole column
 * clear of the bars.
 */
const LABEL_WIDTH = LABEL_COLUMN - ROW_GAP;
const LABEL_RECENTRE = (LABEL_WIDTH - BAR_THICKNESS) / 2;
const LABEL_DISTANCE = LABEL_COLUMN / 2 - (LABEL_GUTTER + LABEL_STRIP / 2) + LABEL_GAP;

/** x of the bars' origin: everything left of it belongs to the label column. */
const PLOT_INSET = LABEL_COLUMN + LABEL_GAP;
const SHIFT_X = PLOT_INSET - ROTATED_ORIGIN_X - LABEL_HEADROOM + VALUE_HEADROOM / 2;
const SHIFT_Y = (ROW_HEIGHT - BAR_THICKNESS) / 2 - ROTATED_ORIGIN_Y - VALUE_HEADROOM / 2;

/**
 * Proportional bar chart.
 *
 * Both layouts are gifted-charts' `BarChart` — horizontal bars are its own
 * `horizontal` mode, which is the vertical chart rotated a quarter turn, and
 * every offset above exists to undo one consequence of that rotation. Nothing
 * here draws a rectangle by hand.
 *
 * Bars are proportional to the largest value in the set rather than to a
 * rounded ceiling: this reads as "which body part got the work", not "how many
 * sets exactly", and a nice axis maximum would leave the peak bar short of the
 * end for no reason the user can see.
 */
export function BarChart({
  data,
  formatValue = (value) => String(Math.round(value)),
  horizontal = true,
  height = 140,
}: BarChartProps) {
  const colors = useColors();

  // The call site hands us no width, and both layouts need one: the horizontal
  // plot has to know what is left after the label column and the value, and the
  // vertical one sizes its columns from it.
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

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

  /**
   * One flat fill per bar, and a datum's own colour overrides the accent.
   *
   * Bars used to fade towards the canvas along their length. A gradient on a
   * proportional bar is a second encoding of the same quantity laid over the
   * first, and a worse one: the far end of a long bar reads as *less* than its
   * base, so a muscle with the most sets ended up with the faintest tip on the
   * chart. Length already says everything this chart has to say.
   */
  const paint = (item: BarDatum) => ({ frontColor: item.color ?? colors.accent });

  if (horizontal) {
    const plotLength = width - PLOT_INSET - VALUE_HEADROOM;
    const bars: barDataItem[] = data.map((item) => ({
      ...paint(item),
      value: item.value,
      // The library's own axis label is a bare `Text` in whatever the platform
      // font happens to be, so both slots are handed a component instead.
      labelComponent: () => (
        <View style={styles.hLabel}>
          <Text variant="label" color="textSecondary" numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ),
      topLabelComponent: () => (
        <View style={styles.hValue}>
          <Text variant="label" numberOfLines={1}>
            {formatValue(item.value)}
          </Text>
        </View>
      ),
    }));

    return (
      <View onLayout={onLayout} style={{ height: data.length * ROW_HEIGHT }}>
        {plotLength > 0 ? (
          <GiftedBarChart
            data={bars}
            horizontal
            // Only moves where the (hidden) value axis is drawn, but it also
            // picks the smaller of the library's two rotation offsets.
            yAxisAtTop
            /*
             * Transposed on purpose. A horizontal chart is rendered rotated, so
             * the library reads `width` as the length of the bars and `height`
             * as the extent across them — the height here is exactly the rows
             * the wrapper reserves.
             */
            width={plotLength}
            height={data.length * ROW_HEIGHT}
            barWidth={BAR_THICKNESS}
            spacing={ROW_GAP}
            initialSpacing={0}
            endSpacing={0}
            maxValue={max}
            minHeight={plotLength * MIN_FILL}
            barBorderRadius={radius.pill}
            labelWidth={LABEL_WIDTH}
            labelsDistanceFromXaxis={LABEL_DISTANCE}
            labelsExtraHeight={LABEL_HEADROOM}
            yAxisExtraHeight={VALUE_HEADROOM}
            shiftX={SHIFT_X}
            shiftY={SHIFT_Y}
            // Every row already prints its own figure, so a value axis, its
            // spine and a set of rules behind the bars would all be restating it.
            hideAxesAndRules
            yAxisLabelWidth={0}
            yAxisThickness={0}
            xAxisThickness={0}
            disableScroll
            isAnimated={false}
          />
        ) : null}
      </View>
    );
  }

  const plotHeight = Math.max(1, height - CAPTION_BAND);
  const slot = width / data.length;
  // Cap the column so a three-bar set doesn't render three slabs; whatever is
  // left over is the gap, split in half at each end so every column sits dead
  // centre of its slot.
  const barWidth = Math.max(3, Math.min(slot * 0.62, 34));
  const gap = slot - barWidth;

  const bars: barDataItem[] = data.map((item) => ({
    ...paint(item),
    value: item.value,
    labelComponent: () => (
      <Text variant="caption" color="textTertiary" align="center" numberOfLines={1}>
        {item.label}
      </Text>
    ),
  }));

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 ? (
        <GiftedBarChart
          data={bars}
          width={width}
          height={plotHeight}
          barWidth={barWidth}
          spacing={gap}
          initialSpacing={gap / 2}
          endSpacing={gap / 2}
          maxValue={max}
          minHeight={plotHeight * MIN_FILL}
          barBorderRadius={Math.min(radius.sm, barWidth / 2)}
          xAxisLabelsHeight={LABEL_STRIP}
          // A baseline and nothing else. Rules would need a value axis to be
          // read against, and this chart is a comparison rather than a reading.
          hideRules
          hideYAxisText
          yAxisLabelWidth={0}
          yAxisThickness={0}
          yAxisExtraHeight={0}
          xAxisColor={colors.border}
          // Doubled because this is an SVG stroke rather than a view border — a
          // hairline stroke gets antialiased away to almost nothing.
          xAxisThickness={stroke.rule * 2}
          disableScroll
          isAnimated={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  hLabel: {
    height: LABEL_STRIP,
    justifyContent: 'center',
    transform: [{ translateY: -LABEL_RECENTRE }],
  },
  // The library sizes the top-label slot to the bar's thickness, which is 10px
  // square here. The figure is positioned out of it rather than inside it.
  hValue: {
    position: 'absolute',
    left: VALUE_GAP,
    top: (BAR_THICKNESS - LABEL_STRIP) / 2,
    width: VALUE_COLUMN,
    height: LABEL_STRIP,
    justifyContent: 'center',
  },
});
