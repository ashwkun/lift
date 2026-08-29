/**
 * Training days, one square per day, on the dashboard grid.
 *
 * The compact read of the same log `ContributionGraph` scrolls a year of on
 * History. That one is a page element: it has a weekday gutter, month labels, a
 * legend and a tappable cell per day. This is a tile, so it keeps only the
 * shape, sizes itself to whatever width the grid gives it, and hands the whole
 * thing to the calendar on a tap.
 *
 * ## Why it is not the accent ramp
 *
 * `dayFill` shades a trained day from `surfaceMuted` towards `accent`, which is
 * right on Calendar and History, where the grid is the subject of the screen.
 * Home spends its accent on the kicker and on the one column of twelve the
 * masthead is reporting: see the note above `trendData` in `(tabs)/index.tsx`
 * for why that budget is one element rather than a style. A hundred accented
 * squares under that figure would make the tile the loudest thing on the page
 * and the headline the second.
 *
 * So the steps are the same and the palette is not: `intensityStep` decides
 * what counts as a heavy day, exactly as it does on the other two screens, and
 * `dayShade` paints it in the neutral ramp the volume run and the body-part
 * bars on this screen are already drawn in. Both ramps live in `day-shading`
 * so the scale cannot drift between the screens that read it.
 */

import { dayKey } from '@lift/shared';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { WideWidget } from '@/components/ui/widget';
import {
  contributionColumns,
  type CalendarDay,
  type WorkoutCalendar,
} from '@/features/analytics/calendar';
import { dayShade, intensityStep } from '@/features/analytics/day-shading';
import { CONTRIBUTION_WEEKS } from '@/features/analytics/contribution-graph';
import { useSettings } from '@/store/settings';
import { spacing, stroke, useColors, type Palette } from '@/theme';

const CELL = 12;
/** Vertical pitch between cells. The horizontal one is whatever fills the row. */
const GAP = 3;
/** Below this the strip stops being a shape and becomes a row of dots. */
const MIN_WEEKS = 8;

export interface CalendarWidgetProps {
  /**
   * The log keyed by day, or null while the first query is in flight. A missing
   * key inside a loaded calendar is a rest day; the whole thing missing is not.
   */
  calendar: WorkoutCalendar | null;
  /** Stamped when the calendar was read, so "today" can't drift mid-render. */
  today: Date;
  /**
   * The space the tile is drawn in. The grid is laid out from a number rather
   * than measured, the same contract `ColumnChart` and the old `BodyweightCard`
   * take, because how many weeks fit is a layout decision this has to make
   * before it can render a single cell.
   */
  width: number;
  onPress?: () => void;
}

export function CalendarWidget({ calendar, today, width, onPress }: CalendarWidgetProps) {
  const colors = useColors();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  // The tile's own padding comes off before anything is counted into it.
  const available = width - spacing.lg * 2;
  const weeks = Math.max(
    MIN_WEEKS,
    Math.min(CONTRIBUTION_WEEKS, Math.floor((available + GAP) / (CELL + GAP))),
  );

  const columns = useMemo(
    () => contributionColumns(today, weeks, firstDayOfWeek),
    [today, weeks, firstDayOfWeek],
  );

  const todayKey = dayKey(today);
  const days = calendar?.days;

  // Days trained inside the strip, not in the whole log: a count that included
  // training the grid cannot show would be describing a different graph.
  const activeDays = useMemo(() => {
    if (!days) return 0;
    let count = 0;
    for (const column of columns) {
      for (const date of column) {
        if (date <= today && days.has(dayKey(date))) count += 1;
      }
    }
    return count;
  }, [columns, days, today]);

  /*
   * Empty until the calendar lands, rather than "Loading" or a zero.
   *
   * "0 of the last 147 days" is a wrong figure held for the frame or two this
   * tile waits behind the tab transition, and it is the exact failure the
   * masthead on this screen documents holding its own frame to avoid. The grid
   * below is already an honest skeleton in the meantime: with no calendar every
   * cell falls to the rest-day fill, so the tile shows an untrained strip and
   * then fills in, rather than showing a number and then correcting it.
   */
  const subtitle = calendar ? `${activeDays} of the last ${weeks * 7} days` : undefined;

  return (
    <WideWidget
      title="Training days"
      subtitle={subtitle}
      icon="grid-outline"
      onPress={onPress}
    >
      {/*
       * Hidden from screen readers, and it is the tile's label that replaces
       * it: seven hundred squares announced one at a time is not a summary, and
       * "142 of the last 364 days" is. The per-day read lives on the calendar
       * this taps through to, where each cell is its own control.
       */}
      <View
        style={styles.grid}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {columns.map((column) => (
          <View key={dayKey(column[0])} style={styles.column}>
            {column.map((date) => {
              const key = dayKey(date);
              return (
                <Cell
                  key={key}
                  day={days?.get(key)}
                  typicalVolumeKg={calendar?.typicalVolumeKg ?? 0}
                  isToday={key === todayKey}
                  isFuture={key > todayKey}
                  colors={colors}
                />
              );
            })}
          </View>
        ))}
      </View>
    </WideWidget>
  );
}

function Cell({
  day,
  typicalVolumeKg,
  isToday,
  isFuture,
  colors,
}: {
  day: CalendarDay | undefined;
  typicalVolumeKg: number;
  isToday: boolean;
  isFuture: boolean;
  colors: Palette;
}) {
  // Three fills, the same three `ContributionGraph` draws: a day that has not
  // happened is not drawn, a rest day gets a neutral square so it still reads
  // as a day that existed, and a trained day gets the ramp.
  const fill = isFuture
    ? 'transparent'
    : day
      ? dayShade(intensityStep(day.volumeKg, typicalVolumeKg), colors)
      : colors.surfaceMuted;

  // Every cell carries a border so the box never changes size between states;
  // it matches its own fill except on today, which is the one square the strip
  // marks, and on a future day, where it matches the tile behind it.
  const border = isToday ? colors.text : isFuture ? colors.surface : fill;

  return <View style={[styles.cell, { backgroundColor: fill, borderColor: border }]} />;
}

const styles = StyleSheet.create({
  // `space-between` rather than a fixed horizontal gap: the number of columns
  // is chosen from the width above, and whatever is left over after whole cells
  // is spread between them instead of pooling at the right-hand edge. On a
  // phone that is under a point per gap; on a tablet board it is what keeps the
  // strip filling the tile rather than trailing off two thirds across it.
  grid: { flexDirection: 'row', justifyContent: 'space-between' },
  column: { gap: GAP },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 3,
    borderWidth: stroke.outline,
  },
});
