import { Ionicons } from '@expo/vector-icons';
import { DATE_SHORT, formatDateTime, formatDurationShort, formatVolume } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Button,
  Card,
  Divider,
  ListRow,
  Reveal,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { METRIC, TREND_METRICS, type TrendMetric } from '@/features/analytics/metrics';
import { bucketLabel } from '@/features/analytics/windows';
import {
  getDashboardStats,
  getMuscleDistribution,
  getWeeklyTotals,
  type DashboardStats,
  type MuscleDistributionEntry,
  type WeeklyPoint,
} from '@/features/analytics/repository';
import { BodyweightSquareWidget } from '@/features/measurements/bodyweight-square-widget';
import { CalendarWidget } from '@/components/widgets/calendar-widget';
import { SquareWidget, WideWidget, StatWidget } from '@/components/ui/widget';
import { listCompletedWorkouts } from '@/features/workouts/repository';
import type { Workout } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { mix, spacing, useColors, useContentWidth, useLayout } from '@/theme';

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

  // `ColumnChart` is laid out from a width rather than measuring itself, so the
  // strip's own margins come off the board this screen is drawn in. `board`,
  // not the window: on a desktop the pane beside the rail is capped at 1040 and
  // the chart has to be told the same number the `Screen` used.
  const chartWidth = useContentWidth('board') - spacing.lg * 2;

  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyPoint[]>([]);
  const [distribution, setDistribution] = useState<MuscleDistributionEntry[]>([]);
  const [recent, setRecent] = useState<Workout[]>([]);

  /*
   * Which of the three the masthead is answering in.
   *
   * State rather than a setting, so it resets to volume on every launch. It is
   * a question you ask of the screen rather than a preference: "how much did I
   * move" is the one this app is built around, and the other two are checks
   * against it rather than replacements for it.
   *
   * Nothing here refetches when it changes. `getWeeklyTotals` returns all three
   * per week in one pass, so a tap is a re-render.
   */
  const [metric, setMetric] = useState<TrendMetric>('volume');

  /*
   * Which week the masthead is reporting on, as that week's Monday.
   *
   * Null is this week, and it is not the same value as the current week's own
   * timestamp: holding the key would pin the masthead to a week that stops
   * being the current one at the next Monday. Null means "whichever week it is
   * now" and survives the rollover.
   *
   * Held as a key rather than as the point itself so it stays valid across a
   * refetch. `weekly` is replaced wholesale on every focus, and a key is looked
   * up again against the new array; a captured object would be a stale copy of
   * a week whose totals had since changed. A key that no longer appears, which
   * is what a week falling out of the twelve looks like, resolves to null and
   * the masthead returns to this week on its own.
   */
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const [shownValue, setShownValue] = useState(0);
  
  const selectedIndex = weekly.findIndex((point) => point.weekStart === selectedWeek);
  const shownIndex = selectedIndex >= 0 ? selectedIndex : weekly.length - 1;
  const shown = weekly[shownIndex] ?? null;
  const config = METRIC[metric];
  const targetValue = shown ? config.pick(shown) : 0;

  useEffect(() => {
    let startTime = Date.now();
    let animationFrame: ReturnType<typeof requestAnimationFrame>;

    const animate = () => {
      const time = Date.now();
      const progress = Math.min((time - startTime) / 800, 1);
      
      // easeOutExpo
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setShownValue(targetValue * ease);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [targetValue]);

  // Aggregates are recomputed on focus rather than live: they only change when
  // a workout is finished, and re-running them on every set write would be
  // wasteful.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const [nextStats, nextWeekly, nextDistribution, nextRecent] = await Promise.all([
          getDashboardStats(),
          getWeeklyTotals(12),
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

  const isThisWeek = shownIndex === weekly.length - 1;
  const before = shownIndex > 0 ? weekly[shownIndex - 1]! : null;
  /*
   * This week reads against the same number of days into last week, not last
   * week's full total. Without this a Monday-morning visit always shows a
   * double-digit decline: the current week has had one day to accumulate
   * anything and the baseline has had seven, no matter how the week goes on to
   * turn out. That is a fact about the calendar rather than about the
   * training, and reading it as a decline is exactly backwards on the one day
   * a streak most needs the app to be encouraging rather than not. A completed
   * past week has no such asymmetry: both sides of that comparison are full
   * weeks, so it keeps reading its own full total.
   */
  const beforeValue = before ? config.pick(isThisWeek ? toDateTotals(before) : before) : 0;

  const [weekFigure, weekUnit] = splitMeasure(config.format(shownValue, weightUnit));

  /*
   * The twelve columns, and only one of them is the accent.
   *
   * Every bar on this screen used to be lime: twelve here, six in the chart
   * below, plus the kicker and the History link. `tokens.ts` budgets roughly
   * one accent element per view on the grounds that the lime is the brightest
   * thing the palette owns; at twenty it stops reading as emphasis and becomes
   * the screen's background texture, which is the actual reason this screen
   * felt busy rather than the amount of content on it.
   *
   * Spending it on one week turns the run from decoration into a sentence: here
   * is where the week you are reading sits among the last twelve. It follows
   * the selection rather than staying on the current week, so the accent always
   * marks the bar the figure above belongs to, and a tap moves it. The rest
   * fade from `borderStrong` to `textSecondary` with recency, so the run reads
   * as time passing without needing an axis to say so. Both ends of that mix
   * are defined in every palette and move together: on the light ones the fade
   * runs light-to-dark, which is the same "older is fainter" in reverse.
   */
  const trendData: ColumnDatum[] = weekly.map((point, index) => {
    // Stops at 0.7 rather than 1 so the most recent *past* week still sits
    // clearly below the accent instead of arriving alongside it.
    const recency = weekly.length > 1 ? (index / (weekly.length - 1)) * 0.7 : 0;

    return {
      key: point.weekStart,
      // Every column carries its own date and `ColumnChart` thins them to five
      // or so: twelve of these across a phone would collide, and which weeks
      // get printed is a layout decision the chart is better placed to make.
      // `bucketLabel` rather than a local format, so a week is written the same
      // way here as in the chart on History.
      label: bucketLabel(new Date(point.weekStart), 'week'),
      value: config.pick(point),
      color:
        index === shownIndex
          ? colors.accent
          : mix(colors.borderStrong, colors.textSecondary, recency),
    };
  });

  /*
   * How that week compares with the one before it.
   *
   * A figure on its own is inert. 52.6k is neither good nor bad without
   * something to read it against, and the screen was asking the user to supply
   * that from memory. Both numbers are the selected metric out of two adjacent
   * buckets, so the comparison holds whichever tab is showing and whichever
   * week is being read: a percentage is one of the few things that means the
   * same in kilograms, minutes and reps.
   *
   * Null when there is nothing honest to say: no week before this one in the
   * window, or a previous week of zero, where the change is not "infinitely
   * better" but "this is the first week".
   */
  const deltaPercent =
    beforeValue > 0 ? Math.round(((targetValue - beforeValue) / beforeValue) * 100) : null;

  /*
   * The two supporting figures, as a sentence rather than a band.
   *
   * These were a `StatBand`: two uppercase labels over two 17px figures, in
   * columns, occupying its own block under the masthead. That is the right
   * component for a table of figures being compared, and these two are not
   * that: they are context for the headline above them. Set as one quiet line
   * they belong to the figure, which turns two blocks into one and takes a
   * whole horizontal rule of structure off the screen.
   *
   * Neither of them changes with the metric, which is the point of leaving them
   * out of the tabs: the sessions behind the headline are the same sessions
   * whichever way it is being counted.
   *
   * The streak is dropped on a past week, and that is not tidiness. A streak is
   * a fact about now, counted back from this week; printed under August it
   * would read as the streak as it stood in August, which is a different number
   * this screen does not have. The session count is a property of the week
   * itself and follows the selection.
   */
  const sessions = shown?.workouts ?? 0;
  const meta = [
    `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`,
    isThisWeek && stats.weekStreak > 0 ? `${stats.weekStreak}-week streak` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * What the kicker calls the week, and what the delta compares it to.
   *
   * "this week" only when it is: on any other week the kicker names the Monday
   * it starts on, because a 40px figure with no date on it is read as the
   * current one. "vs last week" moves with it for the same reason. Read under a
   * selected August week it would mean the week before today rather than the
   * week before that one, which is the sort of caption that is worse than none.
   */
  const kicker =
    isThisWeek || !shown
      ? `${config.label} this week`
      : `${config.label} · week of ${bucketLabel(new Date(shown.weekStart), 'week')}`;
  const deltaCaption = isThisWeek ? 'vs last week' : 'vs week before';

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
         * Five blocks, revealed in the order they are read.
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
         * they arrive together; bodyweight is the next, and each of the two
         * below it is its own.
         *
         * Bodyweight is the exception to the gate: it renders inside a `Reveal`
         * like the rest, but its own query is not `stats`, so it holds its own
         * frame (see `BodyweightCard`) rather than borrowing this one. The two
         * arrive independently, which is honest about the fact that they are
         * two different reads of two different tables.
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
           * `display` at 40px, which is the largest type in the app and the only
           * place it is used. The figure spent a release at `heading` (24) on
           * the grounds that a number filling the width of a phone reads as a
           * scoreboard, and at 24 it read as a caption instead: it is the answer
           * to the only question this screen asks, and every other line in the
           * block is a footnote to it. `adjustsFontSizeToFit` is what makes 40
           * safe rather than optimistic: the figure is one line by contract, and
           * between a seven-figure volume in pounds and a phone set to a large
           * system text size it will not always fit at full size. It shrinks
           * rather than truncating or wrapping, so the worst case is a smaller
           * number and never half of one.
           */}
          <View style={styles.masthead}>
            <Text variant="overline" color="accent" numberOfLines={1}>
              {kicker}
            </Text>
            <Text variant="display" color="text" numberOfLines={1} adjustsFontSizeToFit>
              {weekFigure}
              {weekUnit ? (
                <Text variant="subheading" color="textTertiary">
                  {` ${weekUnit}`}
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
                  size={13}
                  color={deltaPercent >= 0 ? colors.success : colors.danger}
                />
                {/* A size up from the words beside it, and the only figure in
                    the block other than the headline. At 11 under a 40px number
                    it read as a footnote to a footnote. */}
                <Text variant="label" color={deltaPercent >= 0 ? 'success' : 'danger'}>
                  {`${Math.abs(deltaPercent)}%`}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {deltaCaption}
                </Text>
              </View>
            ) : null}

            <Text variant="label" color="textSecondary" style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          {/*
           * The run of twelve, on both axes, tappable, and with no heading.
           *
           * `ColumnChart` rather than the `BarChart` this was: History's chart
           * already had the value axis, the rounded ceiling, the thinned date
           * labels and a full-height touch target per bucket, and the alternative
           * was teaching a second component the same four things. What Home adds
           * to it is a colour per column, because the accent has to be able to
           * mark the week being read: see `trendData`.
           *
           * The heading stays off: this strip is not a section that has to
           * introduce itself, it is the tail of the sentence the figure above
           * starts, and a title would re-open it as one.
           *
           * Both axes are drawn, where before there were bars and a baseline.
           * The value axis costs a 44pt gutter, so the plot starts inboard of
           * the margin every other element on this screen sits on, and it buys
           * the thing a bare run cannot do: read a week that is not this one.
           * Without it the only labelled quantity was the headline, so the
           * eleven columns before the last were a shape and nothing more.
           *
           * A tap on any column is the rest of that: it moves the accent, the
           * kicker, the figure, the delta and the session count onto that week.
           * Tapping it again clears the selection and the block returns to this
           * week, which is also what the twelfth column does, since selecting
           * the current week and selecting nothing show the same figures.
           *
           * 150 tall against the 100 it was. The two rules divide the plot in
           * thirds, and 25pt bands with an 11pt figure beside them read as a
           * label sitting on a line rather than against it. The extra height is
           * also what makes a rest week tappable: the target is the full column
           * slot, not the bar.
           */}
          <View style={styles.strip}>
            <ColumnChart
              data={trendData}
              width={chartWidth}
              height={150}
              selectedKey={selectedWeek}
              onSelect={(datum) => setSelectedWeek(datum?.key ?? null)}
              formatValue={(value) => config.axis(value, weightUnit)}
              describeValue={(value) => config.format(value, weightUnit)}
              emptyLabel="No data yet"
            />
          </View>

          {/*
           * The three metrics, at the foot of the run they redraw.
           *
           * Under the chart rather than over it, and not at the top of the
           * masthead either, which is where a control governing a whole block
           * usually goes. Two reasons it ends up last. The room above the kicker
           * is what the 40px figure is set into, and a track of tabs anywhere in
           * that stack takes it back; and the block reads as one sentence
           * downwards, figure then change then shape, which a control cutting
           * across it interrupts. Sitting under the bars it reads as the axis
           * the run is drawn against, which is what it is.
           *
           * The cost, and it is a real one: the tabs are below the figure they
           * retitle, so the first tap is the one that teaches you they move it.
           * The kicker naming the metric in full ("Duration this week") is what
           * makes that tap legible after the fact.
           *
           * `sm` because it is inside a block rather than heading a screen: the
           * one on History that picks a time range for the page is `md`.
           */}
          <SegmentedControl
            options={TREND_METRICS}
            value={metric}
            onChange={setMetric}
            size="sm"
            label="Metric"
            style={styles.tabs}
          />

          {/*
           * The one rule on the screen, and it is doing structural work: above
           * it is this week, below it is everything else. It replaces the two
           * section headings that used to separate these blocks, which is a
           * hairline in place of two lines of type.
           */}
          <Divider style={styles.rule} />
        </Reveal>

        {/*
         * Bodyweight, between the week and the breakdowns.
         *
         * Above the two blocks below it because it is the only thing on this
         * screen you can act on *today*: the distribution chart and the recent
         * list both report on work already done, and this one is asking for a
         * number that does not exist yet. It is below the masthead because the
         * masthead is what the screen is for.
         *
         * Full width rather than joining the pair below. The pair splits at
         * `expanded` because a bar chart and a list are both happy in half a
         * board; a trend line is the one chart here whose whole job is a slope,
         * and halving its width is halving the horizontal resolution of the
         * only thing it draws.
         *
         * It owns its own data. See the note at the top of `BodyweightCard` for
         * why it is not fetched alongside the three aggregates above.
         */}
        <Reveal index={1}>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginHorizontal: spacing.lg, marginTop: spacing.lg }}>
            <SquareWidget 
              title={recent[0]?.name ?? "No recent workout"}
              subtitle={recent[0] ? formatDateTime(recent[0].startedAt, DATE_SHORT) : 'Log a workout'}
              actionIcon="options-outline"
              onPressAction={() => router.push('/history')}
              onPress={() => recent[0] ? router.push({ pathname: '/workout/[id]', params: { id: recent[0].id } }) : undefined}
            >
               <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: colors.textSecondary, borderTopColor: colors.text, justifyContent: 'center', alignItems: 'center' }}>
                 <Text variant="numericLarge" color="text">{recent.length}</Text>
               </View>
            </SquareWidget>
            
            <BodyweightSquareWidget />
          </View>
        </Reveal>

        <Reveal index={2}>
          <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg }}>
            <CalendarWidget 
              title="Recent Activity"
              subtitle="Past 3 months"
              onPress={() => router.push('/history')}
            />
          </View>
        </Reveal>

        <Reveal index={3}>
           <StatWidget 
              label="Volume lifted"
              sublabel="Last 7 days"
              value={formatVolume(weekly[weekly.length - 1]?.volumeKgToDate ?? 0, weightUnit).split(' ')[0] ?? '0'}
              unit={weightUnit}
              actionIcon="options-outline"
              onPressAction={() => setMetric('volume')}
              style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg }}
           />
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

/** A week's totals truncated to its `*ToDate` fields, for `config.pick`. */
function toDateTotals(point: WeeklyPoint) {
  return {
    volumeKg: point.volumeKgToDate,
    durationSeconds: point.durationSecondsToDate,
    reps: point.repsToDate,
  };
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    // Deeper above than the `lg` it was, and shallower below, because the strip
    // under it now belongs to this block rather than following it. The space
    // this buys above the kicker is what the figure is set into, and it is the
    // reason the tabs sit under the block rather than over it.
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  // Centred rather than baseline-aligned: the caret is a glyph in a 11pt box,
  // not type, so its baseline is not where its arrow is.
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { marginTop: spacing.sm },
  // On the screen's margin like everything else, and nearer the bars above it
  // than the rule below: `md` up against the `xl` the rule brings with it, so
  // the control reads as belonging to the chart rather than as a third thing
  // between the chart and whatever follows the rule.
  // Further from the chart than a control usually sits from what it drives.
  //
  // The gap is measured from the chart's box, and the box ends only a few px
  // below the "0" tick, so at `md` the track was landing on the y-axis origin
  // and reading as part of the plot rather than as something under it. The
  // clearance that is actually wanted is from the glyph, not from the box, and
  // there is no way to say that in a margin: hence a step that looks larger
  // than it is on paper and comes out as ordinary on screen.
  tabs: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
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
