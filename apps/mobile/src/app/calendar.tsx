import { dayKey, formatDurationShort, formatVolume } from '@lift/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  HeaderAction,
  IconButton,
  Screen,
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import {
  addMonths,
  getWorkoutCalendar,
  monthLabel,
  parseDayKey,
  startOfDay,
  startOfMonth,
  summariseMonth,
  type WorkoutCalendar,
} from '@/features/analytics/calendar';
import { MonthGrid, rampSamples } from '@/features/analytics/month-grid';
import { haptics } from '@/features/feedback/haptics';
import { WorkoutCard } from '@/features/workouts/workout-card';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing, stroke, useColors, useContentWidth } from '@/theme';

/** What a figure reads before its query has answered. Never a zero: see Profile. */
const PENDING = '—';

/**
 * Stands in for a log that could not be read.
 *
 * A failed query counts as loaded, the same rule `records.tsx` applies: a screen
 * that never answers has to fall through to its empty state rather than sit
 * blank for the rest of the visit.
 */
const UNREADABLE: WorkoutCalendar = { days: new Map(), first: null, typicalVolumeKg: 0 };

export default function CalendarScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();
  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const weightUnit = useSettings((state) => state.weightUnit);
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  /**
   * The day this screen was opened onto, when it arrived from a tap on a
   * square elsewhere (the contribution graph on Home) rather than from the
   * tab bar. Read once: this screen owns paging and selection from here, and
   * a param that kept overriding local state would fight every tap after the
   * first.
   */
  const params = useLocalSearchParams<{ date?: string }>();
  const initialDate = params.date ? parseDayKey(params.date) : null;

  const [calendar, setCalendar] = useState<WorkoutCalendar | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(initialDate ?? new Date()));
  const [today, setToday] = useState(() => startOfDay(new Date()));

  /**
   * The day whose sessions are listed below the grid, or null for the month.
   *
   * Starts null rather than on today: opening the screen onto "rest day" would
   * spend the whole panel saying nothing on any day someone hasn't trained yet,
   * where the month list always has something to show. A day arriving via
   * `initialDate` is the one exception, since it was chosen deliberately.
   */
  const [selected, setSelected] = useState<Date | null>(initialDate);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const now = new Date();
        const next = await getWorkoutCalendar().catch(() => UNREADABLE);
        if (cancelled) return;

        // Refreshed on focus rather than frozen at mount, so an app left open
        // overnight doesn't ring yesterday. Compared by day so the common case
        // (same day, new object) doesn't cost a render.
        setToday((previous) => (dayKey(previous) === dayKey(now) ? previous : startOfDay(now)));
        setCalendar(next);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const summary = useMemo(
    () => (calendar ? summariseMonth(calendar.days, month) : null),
    [calendar, month],
  );

  const todayKey = dayKey(today);
  const selectedKey = selected ? dayKey(selected) : null;
  const selectedDay = selectedKey ? (calendar?.days.get(selectedKey) ?? null) : null;

  const thisMonth = startOfMonth(today);
  const firstMonth = calendar?.first ? startOfMonth(calendar.first) : null;

  // Paging stops at both ends of what there is to see: before the first workout
  // and after this month there is nothing but empty grids, and a chevron that
  // pages forever into blank months is an invitation to get lost.
  const canGoBack = firstMonth !== null && month.getTime() > firstMonth.getTime();
  const canGoForward = month.getTime() < thisMonth.getTime();
  const isThisMonth = month.getTime() === thisMonth.getTime();

  const goToMonth = (step: number) => {
    haptics.selection();
    setMonth((previous) => addMonths(previous, step));
    // The selection belongs to the month it was made in; carrying a day across
    // would leave the panel describing a square nobody can see.
    setSelected(null);
  };

  // Screen padding, then the grid card's own, then the card's outline. The card
  // is unpadded so the grid can sit closer to the edges than a standard card's
  // 16 would allow. Seven columns is the one layout in the app that genuinely
  // wants the width, and the two points of border have to come off as well or
  // the outer columns are clipped by the radius they sit inside.
  const available = width - spacing.lg * 2 - spacing.md * 2 - stroke.outline * 2;

  // Everything the header needs is known before the log loads, so the title and
  // its actions never flash.
  const header = (
    <Stack.Screen
      options={{
        title: 'Calendar',
        headerRight: () =>
          isThisMonth ? null : (
            <HeaderAction
              label="Jump to this month"
              title="Today"
              onPress={() => {
                haptics.selection();
                setMonth(thisMonth);
                setSelected(null);
              }}
            />
          ),
      }}
    />
  );

  // An empty log gets the whole screen rather than a grid of blank squares over
  // a band of dashes, which is what History does with the same situation.
  if (calendar && calendar.first === null) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        <EmptyState
          icon="calendar-outline"
          title="No workouts yet"
          description="Finished sessions land on this calendar, shaded by how much you lifted that day."
          action={<Button title="Go to Workout" onPress={() => router.push('/(tabs)/workout')} />}
        />
      </Screen>
    );
  }

  const [volume, volumeUnit]: [string, string | undefined] = summary
    ? splitMeasure(formatVolume(summary.volumeKg, weightUnit))
    : [PENDING, undefined];

  const listed = selectedKey ? (selectedDay?.workouts ?? []) : (summary?.workouts ?? []);

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <View style={styles.monthBar}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Previous month"
            disabled={!canGoBack}
            color={canGoBack ? colors.textSecondary : colors.textTertiary}
            onPress={() => goToMonth(-1)}
          />
          {/* One live region rather than a toast: paging is the only thing on
              this screen that changes what every figure below refers to, so the
              month has to be announced when it moves. */}
          <Text
            variant="subheading"
            align="center"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
            style={styles.monthLabel}
          >
            {monthLabel(month)}
          </Text>
          <IconButton
            name="chevron-forward"
            accessibilityLabel="Next month"
            disabled={!canGoForward}
            color={canGoForward ? colors.textSecondary : colors.textTertiary}
            onPress={() => goToMonth(1)}
          />
        </View>

        <StatBand
          items={[
            { label: 'Sessions', value: summary ? String(summary.workouts.length) : PENDING },
            { label: 'Volume', value: volume, unit: volumeUnit },
            {
              label: 'Time',
              value: summary ? formatDurationShort(summary.durationSeconds) : PENDING,
            },
          ]}
        />

        <Card padded={false} style={styles.gridCard}>
          <MonthGrid
            monthStart={month}
            firstDayOfWeek={firstDayOfWeek}
            days={calendar?.days ?? EMPTY_DAYS}
            typicalVolumeKg={calendar?.typicalVolumeKg ?? 0}
            available={available}
            selectedKey={selectedKey}
            todayKey={todayKey}
            onSelect={(date) => {
              haptics.selection();
              // Tapping the open day closes it, the same toggle the muscle rows
              // on History use, and the only way back to the month list that
              // doesn't require finding the button above.
              setSelected((previous) =>
                previous && dayKey(previous) === dayKey(date) ? null : date,
              );
            }}
            weightUnit={weightUnit}
          />

          {/* The scale in the grid's own colours, and one line saying what it
              is a scale *of*: without which the shading is decoration. The
              swatch row is one accessibility element with a label rather than
              four unlabelled views, the same treatment the body map's legend
              gets. */}
          <View style={styles.legendBlock}>
            <View
              accessible
              accessibilityLabel="Colour scale, from a light day through to a heavy one"
              style={[styles.legend, { borderTopColor: colors.border }]}
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

            <Text variant="caption" color="textTertiary" align="center">
              Each day shaded by volume, against your typical session
            </Text>
          </View>
        </Card>

        <Text variant="caption" color="textTertiary" align="center" style={styles.caption}>
          {summary
            ? `Trained ${summary.activeDays} of ${summary.daysInMonth} days${
                summary.prCount > 0
                  ? ` · ${summary.prCount === 1 ? '1 record' : `${summary.prCount} records`}`
                  : ''
              }`
            : // A blank line, not an absent one: the panel below must not step
              // up and back down as the figures arrive.
              ' '}
        </Text>

        <View style={styles.listHeader}>
          <Text variant="overline" color="textSecondary" numberOfLines={1} style={styles.flex}>
            {selected
              ? `${selected.toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}${selectedKey === todayKey ? ' · Today' : ''}`
              : monthLabel(month)}
          </Text>
          {selected && (
            <Button
              title="Show month"
              variant="ghost"
              size="sm"
              onPress={() => setSelected(null)}
            />
          )}
        </View>

        {/* Nothing at all until the log has been read. "Nothing logged" is a
            claim about someone's training, and it was the wrong one on every
            visit to this screen for as long as the query takes. */}
        {calendar === null ? null : listed.length > 0 ? (
          <View style={styles.list}>
            {listed.map((workout) => (
              <WorkoutCard
                key={workout.id}
                workout={workout}
                weightUnit={weightUnit}
                // Inside one day the date is the heading above; what separates
                // two sessions on the same square is the clock.
                detail={
                  selected
                    ? workout.startedAt.toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : undefined
                }
              />
            ))}
          </View>
        ) : (
          <Card style={styles.quiet}>
            <Text variant="label" color="textTertiary" align="center">
              {selectedKey
                ? selectedKey > todayKey
                  ? 'Not yet'
                  : 'Rest day'
                : `Nothing logged in ${monthLabel(month)}`}
            </Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Stable identity for the pre-load render, so the grid doesn't rebuild on each frame. */
const EMPTY_DAYS: WorkoutCalendar['days'] = new Map();

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  monthLabel: { flex: 1 },
  gridCard: { padding: spacing.md, gap: spacing.md },
  legendBlock: { gap: spacing.sm },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: stroke.rule,
  },
  legendSwatches: { flexDirection: 'row', gap: 3 },
  swatch: { width: 18, height: 8, borderRadius: 2 },
  caption: { marginTop: -spacing.xs },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  flex: { flex: 1 },
  list: { gap: spacing.md },
  quiet: { paddingVertical: spacing.xl },
});
