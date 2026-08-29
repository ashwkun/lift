import { dayKey, formatVolume, type WeightUnit } from '@lift/shared';
import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { spacing, stroke, useColors, type Palette } from '@/theme';

import { contributionColumns, weekdayHeadings, type CalendarDay } from './calendar';
import { dayFill, intensityStep, rampSamples } from './day-shading';

/** How many weeks the strip covers. A year, the same span GitHub shows. */
export const CONTRIBUTION_WEEKS = 52;

const CELL = 13;
const GAP = 4;
const MONTH_LABEL_HEIGHT = 14;
const WEEKDAY_LABEL_WIDTH = 18;
/** Bigger than the cell itself: at 13px a raw touch target is too easy to miss. */
const CELL_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

export interface ContributionGraphProps {
  /** The whole log, keyed by day. Missing keys are rest days. */
  days: Map<string, CalendarDay>;
  typicalVolumeKg: number;
  firstDayOfWeek: 0 | 1;
  today: Date;
  weightUnit: WeightUnit;
  onSelectDay: (date: Date) => void;
}

/**
 * A year of training, one square per day, shaded by how much was lifted.
 *
 * `MonthGrid` already does this at page scope, one month at a time; this is
 * the other read of the same log, traded for scope instead of detail. Paging
 * answers "what happened on this day", scrolling this strip answers "how
 * consistent have I actually been", which is a shape a stack of monthly pages
 * can't show without flipping through all twelve.
 *
 * Untrained days get a visible neutral square rather than blending into the
 * card, unlike `MonthGrid`'s rest days: there is no date number here to carry
 * "this day existed", so the fill is the only thing that can.
 */
export function ContributionGraph({
  days,
  typicalVolumeKg,
  firstDayOfWeek,
  today,
  weightUnit,
  onSelectDay,
}: ContributionGraphProps) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);

  const columns = useMemo(
    () => contributionColumns(today, CONTRIBUTION_WEEKS, firstDayOfWeek),
    [today, firstDayOfWeek],
  );
  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);
  const todayKey = dayKey(today);

  // Trained days within the strip, not the whole log: a figure that includes
  // years the grid can't scroll back to would describe a graph this isn't.
  const activeDays = useMemo(
    () => columns.reduce((count, column) => count + countTrained(column, days), 0),
    [columns, days],
  );

  return (
    <View style={styles.block}>
      <Text variant="caption" color="textTertiary">
        {activeDays === 0
          ? 'No sessions in the last year'
          : `${activeDays} ${activeDays === 1 ? 'day' : 'days'} trained in the last year`}
      </Text>

      <View style={styles.row}>
        {/* Fixed, so it never scrolls out from under the grid it labels. */}
        <View style={styles.weekdayColumn}>
          {headings.map((heading, index) => (
            <View key={heading.long} style={styles.weekdayCell}>
              {/* Every other row: seven of these against 13px squares is a
                  wall of letters. Mon/Wed/Fri (or their locale equivalents)
                  is what GitHub's own graph shows for the same reason. */}
              {index % 2 === 1 ? (
                <Text variant="caption" color="textTertiary" numberOfLines={1}>
                  {heading.narrow}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* Scrolled to the end on layout, so the strip opens on today rather
            than on training from a year ago. */}
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View>
            <View style={styles.monthRow}>
              {columns.map((column, index) => (
                <View key={dayKey(column[0])} style={styles.monthCell}>
                  {monthLabel(columns, index) ? (
                    <Text variant="caption" color="textTertiary" numberOfLines={1}>
                      {monthLabel(columns, index)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {columns.map((column) => (
                <View key={dayKey(column[0])} style={styles.column}>
                  {column.map((date) => {
                    const key = dayKey(date);
                    return (
                      <GraphCell
                        key={key}
                        date={date}
                        day={days.get(key)}
                        typicalVolumeKg={typicalVolumeKg}
                        isToday={key === todayKey}
                        isFuture={key > todayKey}
                        weightUnit={weightUnit}
                        onPress={onSelectDay}
                        colors={colors}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* The scale in the grid's own colours, the same swatches `MonthGrid`
          draws its legend from: one ramp, read the same way on both screens. */}
      <View
        accessible
        accessibilityLabel="Colour scale, from a light day through to a heavy one"
        style={styles.legend}
      >
        <Text variant="caption" color="textTertiary">
          Lighter
        </Text>
        <View style={styles.legendSwatches}>
          {rampSamples(colors).map((color) => (
            <View key={color} style={[styles.swatch, { backgroundColor: color }]} />
          ))}
        </View>
        <Text variant="caption" color="textTertiary">
          Heavier
        </Text>
      </View>
    </View>
  );
}

function countTrained(column: Date[], days: Map<string, CalendarDay>): number {
  let count = 0;
  for (const date of column) {
    if (days.has(dayKey(date))) count += 1;
  }
  return count;
}

/**
 * A month name above the column its first day falls in, and only there: two
 * consecutive columns in the same month print nothing, which is what keeps
 * the row from repeating "Aug" four times running.
 */
function monthLabel(columns: Date[][], index: number): string | null {
  const date = columns[index][0];
  const previous = index > 0 ? columns[index - 1][0] : null;

  if (previous && previous.getMonth() === date.getMonth() && previous.getFullYear() === date.getFullYear()) {
    return null;
  }

  return date.toLocaleDateString(undefined, { month: 'short' });
}

function GraphCell({
  date,
  day,
  typicalVolumeKg,
  isToday,
  isFuture,
  weightUnit,
  onPress,
  colors,
}: {
  date: Date;
  day: CalendarDay | undefined;
  typicalVolumeKg: number;
  isToday: boolean;
  isFuture: boolean;
  weightUnit: WeightUnit;
  onPress: (date: Date) => void;
  colors: Palette;
}) {
  // Three fills: a future day is not drawn at all, a rest day gets a neutral
  // square so it still reads as "happened", and a trained day gets the ramp.
  const fill = isFuture ? 'transparent' : day ? dayFill(intensityStep(day.volumeKg, typicalVolumeKg), colors) : colors.surfaceMuted;

  // The border always matches its resting fill (or the card behind it, on a
  // future day) so a stroke that exists in only one state never appears: see
  // `stroke` in the tokens. Today is the one exception, marked by a ring in
  // the text colour, since there is no date number here to carry it instead.
  const border = isToday ? colors.text : isFuture ? colors.surface : fill;

  const announced = date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const detail = day
    ? `${day.workouts.length === 1 ? '1 workout' : `${day.workouts.length} workouts`}, ${formatVolume(day.volumeKg, weightUnit)}${
        day.prCount > 0
          ? `, ${day.prCount === 1 ? '1 personal record' : `${day.prCount} personal records`}`
          : ''
      }`
    : isFuture
      ? 'not yet'
      : 'no workout';

  return (
    <Pressable
      disabled={isFuture}
      accessibilityRole="button"
      accessibilityLabel={`${isToday ? 'Today, ' : ''}${announced}, ${detail}`}
      accessibilityHint={day ? 'Opens this day on the calendar' : undefined}
      hitSlop={CELL_HIT_SLOP}
      onPress={() => onPress(date)}
      style={({ pressed }) => [
        styles.cell,
        { backgroundColor: fill, borderColor: border },
        pressed && !isFuture && styles.pressed,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  row: { flexDirection: 'row' },
  weekdayColumn: {
    width: WEEKDAY_LABEL_WIDTH,
    marginRight: spacing.xs,
    paddingTop: MONTH_LABEL_HEIGHT + spacing.xs,
    gap: GAP,
  },
  weekdayCell: { height: CELL, justifyContent: 'center' },
  monthRow: { flexDirection: 'row', gap: GAP, height: MONTH_LABEL_HEIGHT, marginBottom: spacing.xs },
  monthCell: { width: CELL, justifyContent: 'flex-end' },
  grid: { flexDirection: 'row', gap: GAP },
  column: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3, borderWidth: stroke.outline },
  pressed: { opacity: 0.65 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  legendSwatches: { flexDirection: 'row', gap: 3 },
  swatch: { width: 18, height: 8, borderRadius: 2 },
});
