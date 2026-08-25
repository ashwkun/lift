/**
 * Bodyweight, on Home.
 *
 * It used to live two taps away: Profile, then Measurements, then a row among
 * fifteen, and only then a chart. That is the right depth for a calf
 * circumference measured twice a year and the wrong depth for the one figure
 * people log daily and want to see the shape of. So the shape comes to the
 * front page, with the control that adds to it beside it.
 *
 * ## Why it owns its own query
 *
 * Home's other blocks are aggregates over the workout tables, fetched together
 * in one focus effect because they change together: a workout finishes and all
 * three move. This one moves on a different clock entirely. It changes when a
 * weight is typed into the morning notification, which can land while Home is
 * the screen on top and nothing has navigated. `useMeasurementRevision` is what
 * closes that gap, and keeping the query here rather than in `HomeScreen` is
 * what stops a bodyweight entry from re-running the three aggregates that
 * cannot possibly have changed.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  changeOverWindow,
  daysSince,
  formatMeasurementDelta,
  formatMeasurementValue,
  isNegligibleChange,
  selectWindow,
  summarizeMeasurements,
  type MeasurementUnitPreferences,
} from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LineChart, type DataPoint } from '@/components/charts/line-chart';
import { Button, EmptyState, SectionHeader, splitMeasure, Text } from '@/components/ui';
import type { BodyMeasurement } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

import { MeasurementEntrySheet, type MeasurementEntryInput } from './entry-sheet';
import { describeRate, describeRecency } from './insights';
import { getMeasurementHistory, recordMeasurement, toMeasurementPoints } from './repository';
import { useMeasurementRevision } from './revision';

/**
 * How much of the series the plot covers.
 *
 * Ninety days rather than the whole log. Bodyweight is a slow number read at
 * speed: over three months a plateau, a cut and a bulk all look like themselves,
 * and over three years they compress into one line with no readable slope
 * anywhere on it. The detail screen has the range control for anyone who wants
 * the long view; this is the block that has to answer "which way am I going"
 * without being asked a second question first.
 */
const WINDOW_DAYS = 90;

/** The window the headline delta is measured over. */
const DELTA_DAYS = 30;

/**
 * Past this, the reading on top is old enough that the card says so.
 *
 * Matches `STALE_AFTER_DAYS` on the measurements screen in spirit but not in
 * value: this block is about a daily habit rather than a monthly tape, and a
 * fortnight-old weigh-in on the front page should read as a gap rather than as
 * the current figure.
 */
const STALE_AFTER_DAYS = 14;

export interface BodyweightCardProps {
  /**
   * The plot's width. `LineChart` is laid out from a number rather than
   * measuring itself, so the caller has to hand it the board it is drawn in
   * minus its own margins: see `useContentWidth` at Home's call site.
   */
  width: number;
}

export function BodyweightCard({ width }: BodyweightCardProps) {
  const colors = useColors();

  // Primitive selectors, never an object literal: Zustand feeds the selector's
  // result to `useSyncExternalStore`, which re-renders on identity change.
  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);
  const prefs = useMemo<MeasurementUnitPreferences>(
    () => ({ weightUnit, measurementUnit }),
    [weightUnit, measurementUnit],
  );

  const revision = useMeasurementRevision((state) => state.revision);

  const [rows, setRows] = useState<BodyMeasurement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [logging, setLogging] = useState(false);

  // Stamped when the data is read rather than on every render, so "3 days ago"
  // is computed against one instant instead of drifting as the block renders.
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const history = await getMeasurementHistory('bodyweight').catch(() => null);
    if (history) {
      setRows(history);
      setNow(Date.now());
    }
    setLoaded(true);
  }, []);

  // `revision` is in the dependency list rather than read inside, so a write
  // from anywhere. The sheet below, the notification responder, the Body
  // settings page. Rebuilds this callback and re-runs the effect.
  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, revision]),
  );

  const points = useMemo(() => toMeasurementPoints(rows), [rows]);
  const stats = useMemo(() => summarizeMeasurements(points), [points]);

  const latest = rows.length > 0 ? rows[rows.length - 1]! : null;

  /*
   * The plot, and what to do when the window is empty.
   *
   * Someone who logged faithfully for a year and then stopped for four months
   * has a series and no readings inside ninety days, and an empty plot under a
   * figure that is plainly there reads as a broken chart rather than as a gap.
   * Falling back to the whole series is the same decision the detail screen
   * makes about its range control, and for the same reason.
   */
  const plotted = useMemo<DataPoint[]>(() => {
    const windowed = selectWindow(points, WINDOW_DAYS, now);
    const source = windowed.length >= 2 ? windowed : points;
    return source.map((point) => ({ x: point.at, y: point.value }));
  }, [points, now]);

  const change = useMemo(() => changeOverWindow(points, DELTA_DAYS, now), [points, now]);

  const openSheet = () => {
    haptics.added();
    setLogging(true);
  };

  const submit = (input: MeasurementEntryInput) => {
    setLogging(false);
    haptics.logged();

    void (async () => {
      await recordMeasurement({ kind: 'bodyweight', ...input });

      // Explicit, on top of the revision bump the write already fires. That
      // bump is the path for writes this component did not make; refetching
      // here is the path for the one it did, and it does not depend on a focus
      // effect re-running to be correct.
      await reload();

      // The reminder's body quotes the last reading, so a weight logged here
      // has to reach it too. Imported lazily: this is the one path into the
      // notification module from a screen that renders on the web, where there
      // is no notification module to reach.
      await import('@/features/notifications/weigh-in')
        .then(({ refreshWeighInReminder }) => refreshWeighInReminder())
        .catch(() => {});
    })();
  };

  const sheet = (
    <MeasurementEntrySheet
      visible={logging}
      kind={logging ? 'bodyweight' : null}
      previous={latest}
      onCancel={() => setLogging(false)}
      onSubmit={submit}
    />
  );

  /*
   * Nothing is drawn until the query answers.
   *
   * The same reasoning that holds the rest of Home behind `stats`: this block
   * would otherwise paint its empty state for a frame and then be replaced by a
   * chart, which is a worse first impression than a beat of nothing.
   */
  if (!loaded) return null;

  if (!latest || !stats) {
    return (
      <>
        <SectionHeader title="Bodyweight" />
        <View style={styles.block}>
          <EmptyState
            icon="scale-outline"
            title="No weigh-ins yet"
            description="Log one and this becomes a trend line. Push-ups, pull-ups and dips are valued at it too."
            action={<Button title="Log your weight" icon="add" size="sm" onPress={openSheet} />}
          />
        </View>
        {sheet}
      </>
    );
  }

  const [figure, unit] = splitMeasure(formatMeasurementValue('bodyweight', latest.value, prefs));

  const days = daysSince(latest.measuredAt.getTime(), now);
  const rate = describeRate('bodyweight', stats, prefs);

  /*
   * The line under the figure: when it was taken, and how fast it is moving.
   *
   * The rate is dropped rather than faked when `describeRate` declines it: a
   * slope fitted to two readings three days apart turns a normal overnight
   * swing into "+2.1 kg per week", which is the single most misleading sentence
   * this app could print about the number people are most anxious about.
   */
  const meta = [describeRecency(days), rate].filter(Boolean).join(' · ');

  /*
   * Which way is good is not something this card decides.
   *
   * Everywhere else in the app a rise is `success` and a fall is `danger`,
   * because more volume is more work done. Bodyweight has no such direction:
   * the same +1.2 kg is a bulk going to plan or a cut coming apart, and the app
   * has never asked which one the user is on. So the delta gets a caret for
   * direction and the neutral text colour for everything else, and the reader
   * supplies the judgement.
   */
  const rising = change != null && change.delta > 0;
  const flat = change != null && isNegligibleChange('bodyweight', change.delta, prefs);

  return (
    <>
      <SectionHeader
        title="Bodyweight"
        action={
          <View style={styles.actions}>
            {/*
              The quick add, and the reason this block is on Home at all. Icon
              and word both: a bare "+" beside a chart is as easily read as a
              zoom control, and this is the one button here that writes.
            */}
            <Button title="Log" icon="add" variant="secondary" size="sm" onPress={openSheet} />
            <Button
              title="All"
              variant="ghost"
              size="sm"
              accessibilityLabel="All bodyweight readings"
              onPress={() =>
                router.push({ pathname: '/measurement/[kind]', params: { kind: 'bodyweight' } })
              }
            />
          </View>
        }
      />

      <View style={styles.block}>
        <View style={styles.figureRow}>
          <Text variant="numericLarge" color="text" numberOfLines={1} adjustsFontSizeToFit>
            {figure}
            {unit ? (
              <Text variant="subheading" color="textTertiary">
                {` ${unit}`}
              </Text>
            ) : null}
          </Text>

          {change ? (
            <View style={styles.delta}>
              {flat ? null : (
                <Ionicons
                  name={rising ? 'caret-up' : 'caret-down'}
                  size={13}
                  color={colors.textSecondary}
                />
              )}
              <Text variant="label" color="textSecondary">
                {formatMeasurementDelta('bodyweight', change.delta, prefs)}
              </Text>
              <Text variant="caption" color="textTertiary">
                {/*
                  The window actually measured, not the one asked for. A log
                  three weeks old compared against "30 days" is a caption that
                  overstates what the figure covers.
                */}
                {change.spanDays >= DELTA_DAYS ? 'last 30 days' : `last ${change.spanDays} days`}
              </Text>
            </View>
          ) : null}
        </View>

        <Text variant="label" color={days > STALE_AFTER_DAYS ? 'textTertiary' : 'textSecondary'}>
          {meta}
        </Text>

        {/*
          Two readings is the floor for a line. One is a dot in the middle of an
          empty box, which says less than the figure above it already does, so
          the plot is left out until the series can carry it.

          Unboxed and undotted: this follows the rule the distribution chart
          below states, that a box on this screen means the thing inside it is
          tappable, and the scrubbing lives on the detail screen where there is
          room for a readout to land.
        */}
        {plotted.length >= 2 ? (
          <LineChart
            data={plotted}
            width={width}
            height={140}
            color={colors.accent}
            filled
            showDots={false}
            formatValue={(value) =>
              formatMeasurementValue('bodyweight', value, prefs, { withUnit: false })
            }
            formatLabel={(x) =>
              new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            }
          />
        ) : null}
      </View>

      {sheet}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  block: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  // Baseline-aligned: the figure and the delta are two readings of the same
  // quantity, and hanging the small one off the big one's baseline is what makes
  // them read as one line rather than as two stacked blocks.
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  // Centred rather than baseline-aligned, for the reason Home's own delta row
  // documents: the caret is a glyph in an 11pt box, not type.
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
