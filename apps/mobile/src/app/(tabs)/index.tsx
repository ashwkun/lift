import { Ionicons } from '@expo/vector-icons';
import { DATE_SHORT, formatDateTime, formatDurationShort, formatVolume } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import {
  Button,
  Card,
  Divider,
  ListRow,
  Reveal,
  Screen,
  SectionHeader,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import {
  getDashboardStats,
  getMuscleDistribution,
  getWeeklyVolume,
  type DashboardStats,
  type MuscleDistributionEntry,
  type WeeklyVolumePoint,
} from '@/features/analytics/repository';
import { listCompletedWorkouts } from '@/features/workouts/repository';
import type { Workout } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { mix, spacing, useColors, useLayout } from '@/theme';

const BODY_PART_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  legs: 'Legs',
  other: 'Other',
};

export default function HomeScreen() {
  const scrollEdge = useScrollEdge();
  const { isExpanded } = useLayout();
  const colors = useColors();

  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyVolumePoint[]>([]);
  const [distribution, setDistribution] = useState<MuscleDistributionEntry[]>([]);
  const [recent, setRecent] = useState<Workout[]>([]);

  // Aggregates are recomputed on focus rather than live: they only change when
  // a workout is finished, and re-running them on every set write would be
  // wasteful.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const [nextStats, nextWeekly, nextDistribution, nextRecent] = await Promise.all([
          getDashboardStats(),
          getWeeklyVolume(12),
          getMuscleDistribution(30),
          listCompletedWorkouts(3),
        ]);

        if (cancelled) return;
        setStats(nextStats);
        setWeekly(nextWeekly);
        setDistribution(nextDistribution);
        setRecent(nextRecent);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  /*
   * Hold the frame until the first aggregate lands, and then show the
   * dashboard whatever it says.
   *
   * This screen used to paint twice before it was right: `stats` starts null,
   * so the first frame was a 40px "0 kg" masthead over a zeroed streak, and
   * then, if the query came back with no workouts, the whole thing was replaced
   * by a full-page "Let's get started". Wrong figures, then a dead end where
   * the dashboard belongs.
   *
   * Holding on `!stats` removes the first; deleting the empty branch removes
   * the second. A zeroed dashboard is the honest first-run state. The charts
   * already say "Not enough data yet" in their own words, and the layout the
   * user is about to inhabit is legible from launch rather than hidden behind a
   * poster. Only the recent-workouts block hides, because an empty box is not a
   * layout, it is a hole.
   */
  if (!stats) return <Screen width="board" scrolled={scrollEdge.progress}>{null}</Screen>;

  const [weekVolume, weekVolumeUnit] = splitMeasure(
    formatVolume(stats.thisWeekVolumeKg, weightUnit),
  );

  /*
   * The twelve columns, and only the last one is the accent.
   *
   * Every bar on this screen used to be lime: twelve here, six in the chart
   * below, plus the kicker and the History link. `tokens.ts` budgets roughly
   * one accent element per view on the grounds that the lime is the brightest
   * thing the palette owns; at twenty it stops reading as emphasis and becomes
   * the screen's background texture, which is the actual reason this screen
   * felt busy rather than the amount of content on it.
   *
   * Spending it on the current week instead turns the run from decoration into
   * a sentence: here is where this week sits among the last twelve. The rest
   * fade from `borderStrong` to `textSecondary` with recency, so the run reads
   * as time passing without needing an axis to say so. Both ends of that mix
   * are defined in every palette and move together: on the light ones the fade
   * runs light-to-dark, which is the same "older is fainter" in reverse.
   */
  const volumeData: BarDatum[] = weekly.map((point, index) => {
    const week = new Date(point.weekStart);
    const previous = index > 0 ? new Date(weekly[index - 1]!.weekStart) : null;
    const startsMonth = !previous || previous.getMonth() !== week.getMonth();
    const isCurrent = index === weekly.length - 1;
    // Stops at 0.7 rather than 1 so the most recent *past* week still sits
    // clearly below the accent instead of arriving alongside it.
    const recency = weekly.length > 1 ? (index / (weekly.length - 1)) * 0.7 : 0;

    return {
      // Labelled at month boundaries rather than per week. Twelve columns
      // across a phone leaves each one about 25pt, which fits neither "18 Aug"
      // nor "Aug 18"; three or four month names over the run say where in the
      // year the bars are, which is the only thing the x axis is being asked.
      label: startsMonth ? week.toLocaleDateString(undefined, { month: 'short' }) : '',
      value: point.volumeKg,
      color: isCurrent ? colors.accent : mix(colors.borderStrong, colors.textSecondary, recency),
    };
  });

  /*
   * How this week compares with the one before it.
   *
   * A volume figure on its own is inert. 52.6k is neither good nor bad without
   * something to read it against, and the screen was asking the user to supply
   * that from memory. Both numbers come out of `weekly` rather than one from
   * `weekly` and one from `stats`, because a delta whose baseline is bucketed
   * differently from its subject is worse than no delta; both bucket on the
   * same `startOfWeek`.
   *
   * Null when there is nothing honest to say: no previous week in the window,
   * or a previous week of zero, where the change is not "infinitely better" but
   * "this is the first week".
   */
  const previousWeekVolumeKg = weekly.length > 1 ? weekly[weekly.length - 2]!.volumeKg : 0;
  const deltaPercent =
    previousWeekVolumeKg > 0
      ? Math.round(((stats.thisWeekVolumeKg - previousWeekVolumeKg) / previousWeekVolumeKg) * 100)
      : null;

  /*
   * The two supporting figures, as a sentence rather than a band.
   *
   * These were a `StatBand`: two uppercase labels over two 17px figures, in
   * columns, occupying its own block under the masthead. That is the right
   * component for a table of figures being compared, and these two are not
   * that: they are context for the headline above them. Set as one quiet line
   * they belong to the volume figure, which turns two blocks into one and takes
   * a whole horizontal rule of structure off the screen.
   */
  const meta = [
    `${stats.thisWeekWorkouts} ${stats.thisWeekWorkouts === 1 ? 'session' : 'sessions'}`,
    stats.weekStreak > 0 ? `${stats.weekStreak}-week streak` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * Neutral, for the same reason the run above it is.
   *
   * This chart is the least urgent thing on the screen: it repeats at 30-day
   * scope what three dedicated screens under `stats/` show properly, and "All"
   * beside its heading goes to one of them. Painting six full-width bars in the
   * brightest colour the palette owns made it the loudest block on a screen
   * whose subject is the figure at the top, which is precisely backwards.
   *
   * Shaded by rank rather than flat: the length already carries the value, and
   * the ramp adds the ordering back at a glance for the middle of the list,
   * where three bars of nearly equal length otherwise take a moment to sort. It
   * borrows the volume run's idiom deliberately, so the two charts read as one
   * family rather than as two unrelated treatments.
   */
  const maxSets = Math.max(...distribution.map((entry) => entry.sets), 1);
  const distributionData: BarDatum[] = distribution.map((entry) => ({
    label: BODY_PART_LABELS[entry.bodyPart] ?? entry.bodyPart,
    value: entry.sets,
    color: mix(colors.borderStrong, colors.textSecondary, (entry.sets / maxSets) * 0.7),
  }));

  return (
    <Screen width="board" scrolled={scrollEdge.progress}>
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * Four blocks, revealed in the order they are read.
         *
         * Everything below this point is gated on `stats`, so none of it exists
         * until the aggregates land, and they now land deliberately late, held
         * behind the tab transition by `useDeferredFocusEffect`. Without the
         * `Reveal`s that arrival is a pop: an empty canvas one frame, a full
         * dashboard the next. With them it is the screen resolving, which is
         * the same delay described honestly.
         *
         * The stagger is per *block*, not per element. The masthead and the
         * band are one thought (this week, in a word and then in figures) so
         * they arrive together; each chart is its own, and the recent list is
         * last because it is the one thing here you can act on.
         */}
        <Reveal index={0}>
          {/*
           * The headline, and the twelve weeks it sits in, as one block.
           *
           * This screen used to open with a row of three tiles: streak,
           * workouts, active days, and then, immediately below, a card headed
           * "This week" carrying workouts and volume. Two stat blocks stacked,
           * with "workouts" appearing in both at two different scopes and no
           * indication of which was which. Home now answers exactly one
           * question (how is this week going) and the lifetime totals live on
           * Profile, where "lifetime" is the whole point.
           *
           * The volume chart used to be a titled section of its own, below a
           * `StatBand` that was a third block. All three said the same thing at
           * different resolutions, so they are now one: the figure, what it
           * changed by, what it took, and where it falls in the run. Five blocks
           * became three, and the screen stopped being a list of sections that
           * happen to share a subject.
           *
           * The figure is plain text and the kicker above it carries the accent,
           * which is the opposite of the obvious pairing. In the light palette
           * the accent is a dark olive chosen to be legible as text, so
           * accenting the number made the loudest thing on the screen quieter
           * than the label under it. Colouring the small word instead holds in
           * both schemes with no branching on the colour scheme. Do not swap
           * these back.
           *
           * `heading` rather than `display`: the figure came down from 40px to
           * 24 along with every other statistic in the app. A number that fills
           * the width of a phone reads as a scoreboard, and this one is context
           * for the week rather than a score. What gives it presence now is the
           * room around it, not its size.
           */}
          <View style={styles.masthead}>
            <Text variant="overline" color="accent">
              Volume this week
            </Text>
            <Text variant="heading" color="text" numberOfLines={1} adjustsFontSizeToFit>
              {weekVolume}
              {weekVolumeUnit ? (
                <Text variant="label" color="textTertiary">
                  {` ${weekVolumeUnit}`}
                </Text>
              ) : null}
            </Text>

            {deltaPercent !== null ? (
              <View style={styles.delta}>
                {/*
                 * A caret rather than a word, and a role colour rather than a
                 * second sentence. Zero is drawn as a rise so the glyph never
                 * contradicts a "0%" beside it. A flat week is not a decline.
                 */}
                <Ionicons
                  name={deltaPercent >= 0 ? 'caret-up' : 'caret-down'}
                  size={11}
                  color={deltaPercent >= 0 ? colors.success : colors.danger}
                />
                <Text variant="caption" color={deltaPercent >= 0 ? 'success' : 'danger'}>
                  {`${Math.abs(deltaPercent)}%`}
                </Text>
                <Text variant="caption" color="textTertiary">
                  vs last week
                </Text>
              </View>
            ) : null}

            <Text variant="label" color="textSecondary" style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          {/*
           * The run of twelve, with no heading and no value axis.
           *
           * Both are removed for the same reason: this strip is no longer a
           * section that has to introduce itself, it is the tail of the sentence
           * the figure above starts. A heading would re-open it as a section,
           * and the axis: 44pt of gutter plus two rules across the plot.
           * Would push the columns off the margin every other element on this
           * screen sits on. The quantity it would report is already stated at
           * full size directly above, and the delta says which way it moved;
           * what is left for the bars to carry is shape, which needs neither.
           *
           * Columns, not a line. A week's volume is a quantity that was either
           * banked or wasn't. It does not vary continuously between Sunday and
           * Monday, and a line drawn through twelve of them invents a slope
           * across the gap where the reading is simply the next week. Bars also
           * make a missed week read as what it is, a gap on the floor, where the
           * line just leaned through it.
           */}
          <View style={styles.strip}>
            <BarChart
              data={volumeData}
              horizontal={false}
              height={100}
              formatValue={(value) => formatVolume(value, weightUnit, { withUnit: false })}
            />
          </View>

          {/*
           * The one rule on the screen, and it is doing structural work: above
           * it is this week, below it is everything else. It replaces the two
           * section headings that used to separate these blocks, which is a
           * hairline in place of two lines of type.
           */}
          <Divider style={styles.rule} />
        </Reveal>

        {/*
         * The two blocks below the rule, side by side once there is room.
         *
         * This pairing used to be the two charts, which were the only two things
         * on the screen wide enough to be worth splitting. The volume run has
         * since moved into the masthead, so the pair is now the remaining chart
         * and the recent list: a reasonable one, because they answer the two
         * questions left after "how is this week going": where the work went,
         * and what the work was.
         *
         * Only at `expanded`. At `medium` the board is capped at 1040 but the
         * window may be as narrow as 840, and half of that minus the rail is not
         * enough for a bar chart with a label column and a trailing figure: the
         * bars collapse to slivers. One threshold, checked here, rather than a
         * chart that quietly degrades.
         *
         * The chart is not boxed and the list is. It used to sit in a Card,
         * which pushed it to x=32 while the masthead and the section headers all
         * sat at x=16: the one place on the screen where the grid broke, and it
         * broke around the element least able to spare the width. Unboxed, the
         * screen states a rule you can say out loud: boxed means you can touch
         * it. The recent-workouts list keeps its Card because its rows are taps.
         */}
        <View style={isExpanded ? styles.chartRow : undefined}>
          <Reveal index={1} style={isExpanded ? styles.chartColumn : undefined}>
            <SectionHeader
              title="Sets by body part · 30 days"
              action={
                <Button
                  title="All"
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push('/stats/body-distribution')}
                />
              }
            />
            <View style={styles.chart}>
              <BarChart data={distributionData} formatValue={(value) => `${Math.round(value)}`} />
            </View>
          </Reveal>

          {recent.length > 0 ? (
            <Reveal index={2} style={isExpanded ? styles.chartColumn : undefined}>
              <SectionHeader
                title="Recent workouts"
                action={
                  <Button
                    title="History"
                    variant="ghost"
                    size="sm"
                    onPress={() => router.push('/history')}
                  />
                }
              />
              <Card padded={false} style={styles.recentCard}>
                {recent.map((workout, index) => (
                  <View key={workout.id}>
                    {index > 0 && <Divider inset={spacing.lg} />}
                    <ListRow
                      title={workout.name}
                      subtitle={`${formatDateTime(
                        workout.startedAt,
                        DATE_SHORT,
                      )} · ${formatDurationShort(
                        workout.durationSeconds ?? 0,
                      )} · ${formatVolume(workout.totalVolumeKg, weightUnit)}`}
                      onPress={() =>
                        router.push({ pathname: '/workout/[id]', params: { id: workout.id } })
                      }
                    />
                  </View>
                ))}
              </Card>
            </Reveal>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    // Deeper above than the `lg` it was, and shallower below, because the strip
    // under it now belongs to this block rather than following it. The space
    // this buys above the kicker is what gives the figure its presence. The
    // size was deliberately taken away from it, so the room has to do that job.
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  // Centred rather than baseline-aligned: the caret is a glyph in a 11pt box,
  // not type, so its baseline is not where its arrow is.
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { marginTop: spacing.sm },
  strip: { marginHorizontal: spacing.lg },
  rule: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
  chart: { marginHorizontal: spacing.lg },
  recentCard: { marginHorizontal: spacing.lg },
  chartRow: { flexDirection: 'row' },
  // `minWidth: 0` alongside `flex: 1`: a flex child will not shrink below its
  // content, and a bar chart's axis labels are content. Without it an unusually
  // long volume figure widens its column and the two stop being halves.
  chartColumn: { flex: 1, minWidth: 0 },
});
