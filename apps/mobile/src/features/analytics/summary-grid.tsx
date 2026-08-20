import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { fontSize, spacing, useColors } from '@/theme';

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface Delta {
  direction: DeltaDirection;
  /** The size of the change, already formatted and unsigned. */
  text: string;
}

/**
 * The change from one window to the next, or null when there is nothing to
 * compare against.
 *
 * The magnitude is formatted unsigned and the sign is carried by the arrow —
 * "↓ 2.1k kg" rather than "-2.1k kg" — because the formatters in `@lift/shared`
 * put the unit on the end and a minus in front of a collapsed figure reads as
 * part of the number.
 */
export function deltaOf(
  current: number,
  previous: number | null | undefined,
  format: (value: number) => string,
): Delta | null {
  if (previous === null || previous === undefined) return null;

  const difference = current - previous;
  return {
    direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat',
    text: format(Math.abs(difference)),
  };
}

export interface SummaryFigure {
  label: string;
  value: string;
  /** Set apart from the figure — smaller, quieter, on the same baseline. */
  unit?: string;
  delta?: Delta | null;
}

export interface SummaryGridProps {
  items: SummaryFigure[];
}

const ARROWS: Record<DeltaDirection, keyof typeof Ionicons.glyphMap> = {
  up: 'arrow-up',
  down: 'arrow-down',
  flat: 'arrow-forward',
};

/**
 * Four figures for a window, each against the window before it.
 *
 * Only a rise is coloured. A drop in volume is not a failure — deloads are
 * planned, and so are weeks with a wedding in them — so painting every decrease
 * in the danger colour would have the app scolding people for training as
 * written. The arrow carries the direction, which is the honest signal; the
 * colour is reserved for the case worth celebrating.
 */
export function SummaryGrid({ items }: SummaryGridProps) {
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <SummaryTile key={item.label} figure={item} />
      ))}
    </View>
  );
}

function SummaryTile({ figure }: { figure: SummaryFigure }) {
  const colors = useColors();
  const delta = figure.delta;

  return (
    <Card
      style={styles.tile}
      accessible
      accessibilityLabel={[
        figure.label,
        [figure.value, figure.unit].filter(Boolean).join(' '),
        delta ? `${DELTA_WORDS[delta.direction]} ${delta.text}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <Text variant="overline" color="textTertiary" numberOfLines={1}>
        {figure.label}
      </Text>

      <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit style={styles.value}>
        {figure.value}
        {figure.unit ? (
          <Text variant="label" color="textTertiary">{` ${figure.unit}`}</Text>
        ) : null}
      </Text>

      {/* The comparison line holds its height even when there is nothing to
          compare: without it the tiles in a grid where only some figures have a
          previous window would end up different heights. */}
      <View style={styles.delta}>
        {delta ? (
          <>
            <Ionicons
              name={ARROWS[delta.direction]}
              size={12}
              color={delta.direction === 'up' ? colors.success : colors.textTertiary}
            />
            <Text
              variant="caption"
              style={{ color: delta.direction === 'up' ? colors.success : colors.textTertiary }}
              numberOfLines={1}
            >
              {delta.text}
            </Text>
          </>
        ) : (
          <Text variant="caption" color="textTertiary">
            {' '}
          </Text>
        )}
      </View>
    </Card>
  );
}

const DELTA_WORDS: Record<DeltaDirection, string> = {
  up: 'up',
  down: 'down',
  flat: 'unchanged at',
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Two per row on every phone width: half the row minus half the gap.
  tile: { flexBasis: '47%', flexGrow: 1, gap: spacing.xs, padding: spacing.md },
  // A touch below `numericLarge`'s own 32px — four of these stacked two-up is a
  // lot of display type, and the labels above them are what makes the grid
  // scannable.
  value: { fontSize: fontSize.xxl },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 16 },
});
