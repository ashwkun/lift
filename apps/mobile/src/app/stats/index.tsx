import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BodyMap } from '@/components/charts/body-map';
import { Card, Divider, ListRow, Reveal, Screen, Text } from '@/components/ui';
import { DayStrip } from '@/features/analytics/day-strip';
import { getMuscleBoard, type MuscleBoard } from '@/features/analytics/muscle-stats';
import { VolumeLegend } from '@/features/analytics/volume-legend';
import { addDays, startOfDay } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { spacing } from '@/theme';

/** Days the body graph at the top of this screen covers. */
const GRAPH_DAYS = 7;

/**
 * The screens this one leads to.
 *
 * Held as data rather than written out as seven `ListRow`s so the order, the
 * icons and the one-line descriptions live in one place — this list is the only
 * explanation most of these screens will ever get, and a description that
 * drifts from what the screen does is worse than none.
 */
const ADVANCED = [
  {
    href: '/stats/muscle-sets',
    icon: 'stats-chart-outline',
    title: 'Set count per muscle group',
    subtitle: 'How many sets each muscle got, period by period.',
  },
  {
    href: '/stats/muscle-distribution',
    icon: 'git-network-outline',
    title: 'Muscle distribution (chart)',
    subtitle: 'This window against the one before it.',
  },
  {
    href: '/stats/body-distribution',
    icon: 'body-outline',
    title: 'Muscle distribution (body)',
    subtitle: 'A week of sets, drawn on the figures.',
  },
  {
    href: '/stats/main-exercises',
    icon: 'barbell-outline',
    title: 'Main exercises',
    subtitle: 'The lifts your training is actually made of.',
  },
  {
    href: '/stats/leaderboard',
    icon: 'trophy-outline',
    title: 'Leaderboard exercises',
    subtitle: 'Which lifts your log can be ranked on.',
  },
  {
    href: '/stats/monthly-report',
    icon: 'calendar-outline',
    title: 'Monthly report',
    subtitle: 'A recap of one month, against the year around it.',
  },
] as const;

export default function StatisticsScreen() {
  const { width } = useWindowDimensions();
  const [board, setBoard] = useState<MuscleBoard | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        // The window ends at tomorrow's midnight rather than now, so a session
        // finished this evening lands on today's cell instead of just past the
        // edge of the graph that is meant to be showing it.
        const to = addDays(startOfDay(new Date()), 1);
        const from = addDays(to, -GRAPH_DAYS);

        // A rejection leaves the graph unknown rather than the screen broken:
        // everything below it is navigation and has to keep working.
        const next = await getMuscleBoard(from, to).catch(() => null);
        if (!cancelled) setBoard(next);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const mapWidth = width - spacing.lg * 2 - spacing.lg * 2;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Statistics' }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.graph}>
          <View style={styles.graphHeader}>
            <Text variant="overline" color="textSecondary">
              Last {GRAPH_DAYS} days
            </Text>
            <Text variant="caption" color="textTertiary">
              {board ? summarise(board) : ' '}
            </Text>
          </View>

          {/* Nothing at all until the window has been counted. A body map drawn
              from an empty board is a figure with every muscle cold, which is a
              claim about the user's training and the wrong one to make on a
              first frame.

              The card around this is drawn from the first frame and only the
              graph inside it waits, so the `Reveal` goes here rather than
              around the screen: what arrives late is the figure, and the figure
              is what should be seen to arrive. The card holding its size around
              an empty space in the meantime is the honest shape of "counting". */}
          {board && (
            <Reveal>
              <DayStrip days={board.days} />
              <BodyMap width={mapWidth} setsPerWeek={board.setsPerWeek} maxHeight={260} />
              <VolumeLegend />
            </Reveal>
          )}
        </Card>

        {/* A plain overline rather than `SectionHeader`, whose own 16px indent
            is right on screens that scroll edge to edge and wrong here: this
            scroll view is already inset, so the shared component would put the
            heading 16px to the right of the card it sits above. */}
        <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
          Advanced statistics
        </Text>
        <Card padded={false}>
          {ADVANCED.map((entry, index) => (
            <View key={entry.href}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <ListRow
                icon={entry.icon}
                title={entry.title}
                subtitle={entry.subtitle}
                onPress={() => router.push(entry.href)}
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function summarise(board: MuscleBoard): string {
  const trained = board.days.filter((day) => day.workouts > 0).length;
  if (trained === 0) return 'No sessions in this window';
  return `${trained} of ${board.days.length} days · ${board.totalSets} sets`;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  graph: { gap: spacing.md },
  graphHeader: { gap: 2 },
  sectionHeader: { paddingTop: spacing.xl, paddingBottom: spacing.sm },
});
