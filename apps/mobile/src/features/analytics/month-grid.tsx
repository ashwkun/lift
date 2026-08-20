import { dayKey, formatVolume, type WeightUnit } from '@lift/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import {
  MIN_TOUCH_SIZE,
  mix,
  radius,
  readableOn,
  spacing,
  stroke,
  useColors,
  type Palette,
} from '@/theme';

import { monthCells, weekdayHeadings, type CalendarDay } from './calendar';

/**
 * How far each step of the ramp travels from the muted surface towards the
 * accent.
 *
 * Four steps rather than a continuous gradient. A day's volume is a coarse
 * signal — the difference between 8,000 kg and 8,400 kg is noise, and rendering
 * it as a visible shade difference invites the reader to compare two squares
 * that are not meaningfully different. Steps also make the legend honest: four
 * swatches can be shown, a gradient can only be gestured at.
 *
 * The floor sits at 0.38 rather than just off the surface it starts from,
 * because the lightest trained day still has to read as *trained*: there it
 * measures 3.57:1 against the dark card and 1.93:1 against the light one. The
 * light palette cannot reach 3:1 at the bottom of the ramp — its card is white
 * and its accent a mid olive, so a first step that contrasted that strongly
 * would have to start two thirds of the way up and the three above it would
 * have nowhere left to go. What backs it up there is the day number, which
 * changes colour on a trained square, and the label a screen reader is given.
 *
 * The top stops just short of the raw accent so the busiest day of a month
 * reads as the end of a scale rather than as a button. Every step's number
 * clears 5:1 against its own fill in both palettes — see `readableOn`.
 */
const RAMP = [0.38, 0.58, 0.77, 0.96];

/** Gap between day cells. The grid is sized in whole cells plus these. */
const GAP = spacing.xs;

/**
 * Which step of the ramp a day's volume lands on, against the typical day.
 *
 * Absolute, not relative to the month on screen: see `typicalVolumeKg` in
 * `calendar.ts` for why. A day at the median sits on step 1, half again on
 * step 2, and 1.5× the median or more tops the scale — most training days land
 * on the middle two steps, which is what leaves the outliers visible.
 */
export function intensityStep(volumeKg: number, typicalVolumeKg: number): number {
  if (volumeKg <= 0 || typicalVolumeKg <= 0) return 0;

  const ratio = volumeKg / typicalVolumeKg;
  if (ratio < 0.6) return 0;
  if (ratio < 1) return 1;
  if (ratio < 1.5) return 2;
  return 3;
}

export function dayFill(step: number, colors: Palette): string {
  return mix(colors.surfaceMuted, colors.accent, RAMP[step] ?? RAMP[0]);
}

/** The ramp's four stops, for the legend under the grid. */
export function rampSamples(colors: Palette): string[] {
  return RAMP.map((_, step) => dayFill(step, colors));
}

/** Width the grid will occupy given the space available to it. */
export function gridWidth(available: number): number {
  return cellWidth(available) * 7 + GAP * 6;
}

function cellWidth(available: number): number {
  return Math.floor((available - GAP * 6) / 7);
}

export interface MonthGridProps {
  /** First of the month being drawn, at local midnight. */
  monthStart: Date;
  firstDayOfWeek: 0 | 1;
  /** The whole log, keyed by day. Missing keys are rest days. */
  days: Map<string, CalendarDay>;
  typicalVolumeKg: number;
  /** Space the grid has to fill. Cells are sized from it and the row centred. */
  available: number;
  selectedKey: string | null;
  todayKey: string;
  onSelect: (date: Date) => void;
  weightUnit: WeightUnit;
}

/**
 * A month of training, one square per day, shaded by how much was lifted.
 *
 * The colour encodes exactly one thing. Volume is what separates a heavy day
 * from a light one at a glance, and it is the only quantity spent on the fill —
 * personal records, duration and set counts are all in the panel below, where
 * they can be read as words rather than guessed from a tint. A gold dot for a
 * PR day was the obvious addition and is deliberately absent: gold on the top
 * of a lime ramp is the one pairing this palette cannot make legible, and a
 * marker you have to squint at on exactly the days worth marking is worse than
 * no marker at all.
 */
export function MonthGrid({
  monthStart,
  firstDayOfWeek,
  days,
  typicalVolumeKg,
  available,
  selectedKey,
  todayKey,
  onSelect,
  weightUnit,
}: MonthGridProps) {
  const colors = useColors();

  const cells = monthCells(monthStart, firstDayOfWeek);
  const headings = weekdayHeadings(firstDayOfWeek);

  const width = cellWidth(available);
  // Square where there is room, but never below the touch minimum: on a small
  // phone seven columns leave about 34 points each, and a calendar you cannot
  // reliably hit is not a calendar.
  const height = Math.max(width, MIN_TOUCH_SIZE);
  const size = { width, height };

  return (
    <View style={[styles.grid, { width: gridWidth(available) }]}>
      {/* Hidden from screen readers on purpose: the drawn heading is a single
          ambiguous letter, and every cell below already announces its own
          weekday in full. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.headings}
      >
        {headings.map((heading) => (
          <Text
            key={heading.long}
            variant="overline"
            color="textTertiary"
            align="center"
            numberOfLines={1}
            style={{ width }}
          >
            {heading.narrow}
          </Text>
        ))}
      </View>

      {cells.map((date, index) => {
        // Padding, not a day. Rendered rather than skipped so the first week
        // starts in the right column and the last one keeps its shape.
        if (!date) return <View key={`pad-${index}`} style={size} />;

        const key = dayKey(date);

        return (
          <DayCell
            key={key}
            date={date}
            cellKey={key}
            day={days.get(key)}
            typicalVolumeKg={typicalVolumeKg}
            size={size}
            selected={selectedKey === key}
            todayKey={todayKey}
            onPress={onSelect}
            weightUnit={weightUnit}
            colors={colors}
          />
        );
      })}
    </View>
  );
}

function DayCell({
  date,
  cellKey,
  day,
  typicalVolumeKg,
  size,
  selected,
  todayKey,
  onPress,
  weightUnit,
  colors,
}: {
  date: Date;
  /** This cell's `dayKey`, computed once by the grid and reused for its lookups. */
  cellKey: string;
  day: CalendarDay | undefined;
  typicalVolumeKg: number;
  size: { width: number; height: number };
  selected: boolean;
  todayKey: string;
  onPress: (date: Date) => void;
  weightUnit: WeightUnit;
  colors: Palette;
}) {
  const isToday = cellKey === todayKey;
  // `YYYY-MM-DD` sorts chronologically as a string, so this needs no second
  // date object per cell.
  const isFuture = cellKey > todayKey;

  const fill = day ? dayFill(intensityStep(day.volumeKg, typicalVolumeKg), colors) : null;

  // A trained square picks the foreground its own fill can carry — the ramp
  // crosses the point where light text stops working, in both palettes. An
  // untrained one is quieter the further it is from being useful: a future date
  // is not a rest day, it simply hasn't happened.
  const foreground = fill
    ? readableOn(fill, colors)
    : isToday
      ? colors.accent
      : isFuture
        ? colors.textTertiary
        : colors.textSecondary;

  // Three states, three channels, so none of them has to share: the fill says
  // how much was lifted, the dot says today, and the ring says selected. A
  // second meaning on any one of them would make all of it guesswork.
  //
  // The ring is drawn in every state, so selecting a day cannot change the
  // cell's inner width — see `stroke` in the tokens. At rest it is whatever is
  // behind it: the fill on a trained day, the card on an empty one. And it
  // can't be a fixed colour when it is on: over the top of the ramp `text` is
  // all but invisible, while the fill's own foreground reads over it by
  // construction, which is the whole point of `readableOn`.
  const border = selected ? (fill ? foreground : colors.text) : (fill ?? colors.surface);

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
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${isToday ? 'Today, ' : ''}${announced}, ${detail}`}
      // Only where there is something to open. Thirty-one identical hints is
      // noise a screen-reader user has to sit through on every square.
      accessibilityHint={day ? 'Shows this day' : undefined}
      onPress={() => onPress(date)}
      style={({ pressed }) => [
        styles.cell,
        size,
        { backgroundColor: fill ?? 'transparent', borderColor: border },
        // A filled square dims under the thumb; an empty one has no fill to
        // darken and steps to the pressed surface instead, the same split
        // `IconButton` makes.
        pressed && (fill ? styles.pressed : { backgroundColor: colors.surfacePressed }),
      ]}
    >
      <Text variant="numeric" numberOfLines={1} style={{ color: foreground }}>
        {date.getDate()}
      </Text>
      {/* Today's marker, and the slot it sits in on every other day so that no
          number moves. Drawn in the cell's own foreground rather than the
          accent: on a bright square the accent *is* the fill, and a lime dot on
          a lime tile marks nothing. */}
      <View
        style={[styles.today, isToday ? { backgroundColor: foreground } : styles.todayEmpty]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    alignSelf: 'center',
  },
  // Full width so the seven headings break the wrap onto their own line and sit
  // over the columns they name.
  headings: { flexDirection: 'row', gap: GAP, width: '100%', marginBottom: spacing.xs / 2 },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  today: { width: 4, height: 4, borderRadius: 2 },
  todayEmpty: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.65 },
});
