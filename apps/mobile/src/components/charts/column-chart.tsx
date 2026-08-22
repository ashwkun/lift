import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BarChart, type barDataItem } from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { font, fontSize, spacing, stroke, useColors } from '@/theme';

export interface ColumnDatum {
  /** Stable identity for selection. The bucket's start timestamp. */
  key: number;
  label: string;
  value: number;
  /**
   * Overrides `color` for this column alone.
   *
   * For a run where the columns are not all the same thing: Home paints the
   * week it is reporting in the accent and fades the rest by age, so the chart
   * says which bar the figure above it belongs to. Selection is still drawn by
   * fading the others back, so a per-column colour and a highlight compose:
   * the colour says which bar is being read, the opacity says the others are
   * not.
   */
  color?: string;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  width: number;
  height?: number;
  /** Formats the y-axis ticks. Keep it short. The gutter is 44px. */
  formatValue?: (value: number) => string;
  selectedKey?: number | null;
  /** Tapping the selected column again passes null, clearing the selection. */
  onSelect?: (datum: ColumnDatum | null) => void;
  color?: string;
  /** Roughly how many x-axis labels to show before thinning them out. */
  maxLabels?: number;
  /**
   * Shown in place of the plot when there is nothing to draw.
   *
   * Worded by the caller because the two screens mean different things by it:
   * on History the window is one the user chose and can change, and on Home it
   * is a fixed twelve weeks, where "in this range" would name a control that
   * screen does not have.
   */
  emptyLabel?: string;
}

/** The y-axis tick gutter. `formatValue` has to fit inside this. */
const AXIS_GUTTER = 44;
/** Headroom above the top gridline, so a peak column is not flush with the card. */
const TOP_PAD = spacing.md;
/** The strip below the baseline that the x-axis labels are drawn into. */
const LABEL_ROW = spacing.lg;
/** Three ticks (zero, half, ceiling) which is two gaps between them. */
const SECTIONS = 2;
/** Floor for a column's height, in px. See the note on empty buckets below. */
const MIN_BAR = 2;
/** Corner radius on a column. Matches `BarChart`; the reasoning is recorded there. */
const BAR_RADIUS = 3;
/** How far back the columns that are not selected fade. */
const LOWLIGHT = 0.3;

/**
 * Time-bucketed column chart.
 *
 * A column rather than a line: these series are *totals per period*, and a line
 * implies a continuous value moving between samples. Two weeks at 12,000 kg
 * with an empty one between them is a gap, not a slope through 6,000.
 *
 * Bars always start at zero for the same reason. A truncated baseline makes a
 * 5% week-on-week change look like a doubling. `BarChart` measures every column
 * from zero unless it is handed a `yAxisOffset`, so this amounts to never
 * setting one.
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
  emptyLabel = 'No data in this range',
}: ColumnChartProps) {
  const colors = useColors();
  const fill = color ?? colors.accent;

  // The library prints the y-axis ticks itself, so the `caption` variant has to
  // be restated as a style rather than rendered as a `Text`.
  const tickText = useMemo(
    () => ({ fontSize: fontSize.xs, ...font('regular'), color: colors.textTertiary }),
    [colors],
  );

  // `width` and `height` are the whole component; the plot is what is left once
  // the tick gutter and the label strip have taken their share.
  const plotWidth = Math.max(1, width - AXIS_GUTTER);
  const plotHeight = Math.max(1, height - TOP_PAD - LABEL_ROW);

  const chart = useMemo(() => {
    // A run of zeroes is as empty as no run at all, and it is worse to draw:
    // `niceCeiling` floors at 1, so an untrained window would print an axis
    // reading 0, 1, 1 under a flat baseline. Home hits this on a fresh install
    // and on any metric a user's sessions do not record.
    const peak = data.reduce((max, item) => Math.max(max, item.value), 0);
    if (data.length === 0 || peak <= 0) return null;

    const maxValue = niceCeiling(peak);

    const slot = plotWidth / data.length;
    // Cap the bar so a three-bucket range doesn't render three fat slabs. The
    // leftover is the gap, split in half at each end, which puts every column
    // dead centre of its slot.
    const barWidth = Math.max(3, Math.min(slot * 0.62, 34));
    const gap = slot - barWidth;

    // Show every nth label so they never collide; always keep the last bucket,
    // which is the one the user is actually training in.
    const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));

    const bars: barDataItem[] = data.map((item, index) => ({
      value: item.value,
      label: item.label,
      // An empty bucket still gets a bar, painted in nothing: `minHeight` would
      // otherwise draw a rest week and a light week as the same 2px sliver.
      frontColor: item.value > 0 ? (item.color ?? fill) : 'transparent',
      // The library's own label is a bare `Text`, which inherits none of the
      // app's font stack. Thinned-out buckets render nothing rather than being
      // dropped, so the label slots stay aligned to the columns.
      labelComponent:
        (data.length - 1 - index) % labelStep === 0
          ? () => (
              <Text variant="caption" color="textTertiary" align="center" numberOfLines={1}>
                {item.label}
              </Text>
            )
          : () => null,
    }));

    return { bars, barWidth, gap, maxValue };
  }, [data, plotWidth, maxLabels, fill]);

  const selectedIndex = useMemo(
    () => (selectedKey === null ? -1 : data.findIndex((item) => item.key === selectedKey)),
    [data, selectedKey],
  );

  if (!chart) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="label" color="textTertiary">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  // Bottom-up, which is the order `yAxisLabelTexts` is indexed in. The origin is
  // a literal "0" rather than `formatValue(0)`: the unit is already spelled out
  // on the ticks above it, and "0 kg" in a 44px gutter is mostly unit.
  const ticks = ['0'];
  for (let section = 1; section <= SECTIONS; section += 1) {
    ticks.push(formatValue((chart.maxValue / SECTIONS) * section));
  }

  return (
    <View style={{ width }}>
      <BarChart
        data={chart.bars}
        width={plotWidth}
        height={plotHeight}
        barWidth={chart.barWidth}
        spacing={chart.gap}
        initialSpacing={chart.gap / 2}
        endSpacing={chart.gap / 2}
        barBorderRadius={Math.min(BAR_RADIUS, chart.barWidth / 2)}
        // A non-zero value always gets a visible sliver, otherwise a light week
        // is indistinguishable from a rest week.
        minHeight={MIN_BAR}
        disableScroll
        isAnimated={false}
        // The ceiling is the rounded one, and the ticks are spaced to reach it
        // exactly. `stepValue` is deliberately left to the library: it derives
        // `maxValue / noOfSections`, whereas passing both back makes the section
        // count a float division that can land at 1.9999999999999998.
        maxValue={chart.maxValue}
        noOfSections={SECTIONS}
        yAxisLabelTexts={ticks}
        // Only reached if a tick text comes back empty, which sends the library
        // down its own numeric formatting path.
        formatYLabel={(label) => formatValue(Number(label))}
        yAxisLabelWidth={AXIS_GUTTER}
        yAxisLabelContainerStyle={styles.tick}
        yAxisTextStyle={tickText}
        yAxisTextNumberOfLines={1}
        yAxisExtraHeight={TOP_PAD}
        // No vertical axis: the rules already carry the grid, and a spine down
        // the left of three ticks is one line more than the chart needs.
        yAxisThickness={0}
        rulesColor={colors.border}
        // Doubled because these are SVG strokes rather than view borders. A
        // hairline stroke gets antialiased away to almost nothing.
        rulesThickness={stroke.rule * 2}
        rulesLength={plotWidth}
        xAxisColor={colors.border}
        xAxisThickness={stroke.outline}
        xAxisLength={plotWidth}
        xAxisLabelsHeight={LABEL_ROW}
        // Selection is drawn by fading everything else back. At -1 nothing is
        // selected and every column stays at full strength.
        highlightEnabled
        highlightedBarIndex={selectedIndex}
        lowlightOpacity={LOWLIGHT}
        // Selection is handled by the hit row below rather than by the
        // library's own press handling. See the note there.
        disablePress
      />

      {/*
        A full-height target per bucket, laid over the plot.

        The library sizes each column's `TouchableOpacity` to the column, which
        makes a rest week (floored at `MIN_BAR` and painted in nothing) a 2px
        strip of target sitting on the baseline. A rest week is exactly the kind
        of week worth tapping, so the whole slot is the target instead, as it
        was before. Equal flex per child reproduces the slot width the bars were
        laid out against.
      */}
      {onSelect && (
        <View
          style={[styles.hitRow, { left: AXIS_GUTTER, width: plotWidth, height: TOP_PAD + plotHeight }]}
        >
          {data.map((item) => (
            <Pressable
              key={item.key}
              style={styles.hit}
              onPress={() => onSelect(item.key === selectedKey ? null : item)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.key === selectedKey }}
              accessibilityLabel={`${item.label}, ${formatValue(item.value)}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Rounds an axis maximum up to a readable step (1, 2, 2.5 or 5 × 10ⁿ).
 *
 * Without this the top gridline reads "13,847 kg", which nobody parses at a
 * glance, and the half-way tick inherits the same problem.
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
  tick: { alignItems: 'flex-end', paddingRight: spacing.sm },
  hitRow: { position: 'absolute', top: 0, flexDirection: 'row' },
  hit: { flex: 1, height: '100%' },
});
