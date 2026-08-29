/**
 * Bodyweight, as one tile on the dashboard grid.
 *
 * The compact form of what `BodyweightCard` used to draw full-width: the
 * current reading and how old it is, without the ninety-day plot or the delta.
 * That is a real trade rather than an oversight. The tile answers "what do I
 * weigh and is that figure current", and the shape of the last three months is
 * one tap away on the measurement screen the tile opens.
 *
 * ## Why it owns its own query
 *
 * Home's aggregates are fetched together because they move together: a workout
 * finishes and all of them change. This one moves on a different clock. It
 * changes when a weight is typed into the morning notification, which can land
 * while Home is the screen on top and nothing has navigated, so a focus effect
 * alone would leave the figure stale until the user left the tab and came back.
 * `useMeasurementRevision` is what closes that gap, and keeping the query here
 * rather than in `HomeScreen` is what stops a bodyweight entry from re-running
 * four aggregates that cannot possibly have changed.
 */

import { daysSince, formatMeasurementValue, type MeasurementUnitPreferences } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { type ViewStyle } from 'react-native';

import { Text, splitMeasure } from '@/components/ui';
import { SquareWidget, widgetFigure } from '@/components/ui/widget';
import type { BodyMeasurement } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { getMeasurementHistory, recordMeasurement } from './repository';
import { describeRecency } from './insights';
import { useMeasurementRevision } from './revision';
import { MeasurementEntrySheet, type MeasurementEntryInput } from './entry-sheet';
import { haptics } from '@/features/feedback/haptics';

export function BodyweightSquareWidget({
  style,
  tone,
}: {
  style?: ViewStyle;
  /** Passed straight through to the shell. See `tone` in `ui/widget.tsx`. */
  tone?: string;
}) {
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
  // is computed against one instant instead of drifting as the tile renders.
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

  const latest = rows[0];

  /*
   * Nothing is printed until the query lands, and the word "Loading" is not
   * printed at all.
   *
   * The tile is held behind the tab transition by `useDeferredFocusEffect`, so
   * the unloaded state lasts a frame or two. A dash where the figure goes would
   * say "there is no reading" during a wait that has not established that yet,
   * which is the same mistake the masthead above documents holding its whole
   * frame to avoid, and a subtitle reading "Loading" narrates the app's
   * internals for two frames. Both slots stay empty instead, so the tile
   * resolves rather than correcting itself.
   *
   * The dash is kept for the case it is honest about: loaded, and genuinely
   * nothing logged.
   */
  let valueText = '';
  let unitText = '';
  let subText: string | undefined;

  if (loaded) {
    if (latest) {
      const [figure, unit] = splitMeasure(formatMeasurementValue('bodyweight', latest.value, prefs));
      valueText = figure;
      unitText = unit || '';
      const days = daysSince(latest.measuredAt.getTime(), now);
      subText = describeRecency(days) || 'Today';
    } else {
      valueText = '--';
      subText = 'Not logged yet';
    }
  }

  const submit = (input: MeasurementEntryInput) => {
    setLogging(false);
    haptics.logged();
    void (async () => {
      await recordMeasurement({ kind: 'bodyweight', ...input });
      await reload();
      await import('@/features/notifications/weigh-in')
        .then(({ refreshWeighInReminder }) => refreshWeighInReminder())
        .catch(() => {});
    })();
  };

  return (
    <>
      {/*
       * Two affordances that do two things. The tile opens the series, the
       * corner control adds to it. They were briefly the same call, which made
       * the "+" a decoy: a control drawn on a tile that was already entirely
       * pressable, doing what pressing anywhere else on it did.
       */}
      <SquareWidget
        title="Bodyweight"
        subtitle={subText}
        icon="body-outline"
        tone={tone}
        style={style}
        onPress={() =>
          router.push({ pathname: '/measurement/[kind]', params: { kind: 'bodyweight' } })
        }
        action={{ icon: 'add', label: 'Log bodyweight', onPress: () => setLogging(true) }}
      >
        {/* `widgetFigure`, matching the session tile beside it. See its note. */}
        <Text
          variant="numericLarge"
          color="text"
          style={widgetFigure}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {valueText}
          {unitText ? (
            <Text variant="body" color="textSecondary">
              {' '}
              {unitText}
            </Text>
          ) : null}
        </Text>
      </SquareWidget>
      <MeasurementEntrySheet
        visible={logging}
        kind={logging ? 'bodyweight' : null}
        previous={latest}
        onCancel={() => setLogging(false)}
        onSubmit={submit}
      />
    </>
  );
}
