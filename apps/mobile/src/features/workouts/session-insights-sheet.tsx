/**
 * The session drawer: what has been done so far, and where it landed.
 *
 * Mid-set, the logging screen is right to say almost nothing: a fraction, a
 * clock, and the rows being filled in. This is the surface for the other
 * question, the one asked while the bar is loaded or the rest timer is running:
 * *is this session going anywhere*. It is a drawer rather than a panel on the
 * screen for exactly that reason. It costs one tap to open, nothing to ignore,
 * and it cannot push a set row further from the thumb.
 *
 * Two readings, in the order they get asked. How much work is down, against
 * how much was down last time; and which muscles it went to.
 */

import {
  formatVolume,
  MUSCLE_GROUP_LABELS,
  type AnalyticsContext,
} from '@lift/shared';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SessionBodyMap } from '@/components/charts/body-map';
import {
  Divider,
  EmptyState,
  Sheet,
  SheetScrollView,
  Text,
  useSheetLayout,
} from '@/components/ui';
import type { Workout } from '@/db/schema';
import { formatSets } from '@/features/analytics/format';
import { useAppUnits } from '@/features/exercises/units';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

import type { WorkoutExerciseDetail } from './repository';
import {
  compare,
  getSessionBaseline,
  summariseSession,
  type MuscleShare,
  type Progress,
  type SessionBaseline,
  type SessionInsights,
} from './session-insights';

export interface SessionInsightsSheetProps {
  visible: boolean;
  onClose: () => void;
  workout: Workout;
  details: readonly WorkoutExerciseDetail[];
}

export function SessionInsightsSheet({
  visible,
  onClose,
  workout,
  details,
}: SessionInsightsSheetProps) {
  const sheetLayout = useSheetLayout();
  const { weightUnit } = useAppUnits();
  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);

  const context = useMemo<Pick<AnalyticsContext, 'bodyweightKg' | 'formula'>>(
    () => ({ bodyweightKg: bodyweightKg ?? undefined, formula }),
    [bodyweightKg, formula],
  );

  /*
   * Only while open, deliberately.
   *
   * This component is mounted for the whole session so the drawer can animate
   * in rather than pop, which means its inputs change on every keystroke in
   * every set row. The tally is a pass over a handful of sets and would be
   * affordable either way, but this screen has spent real effort keeping the
   * per-keystroke work down (see the ticker note in `active.tsx`), and a
   * closed drawer has no reason to be part of it.
   */
  const insights = useMemo(
    () => summariseSession(visible ? details : [], context),
    [visible, details, context],
  );

  /*
   * Last time, fetched once per opening rather than held live.
   *
   * It is a finished session: nothing about it can change while this one is
   * being logged, so a `useLiveQuery` would re-run for no reason. Refetched on
   * each open only because the session's own name can be edited mid-workout,
   * and the name is one of the three things that decides which session "last
   * time" means.
   */
  const [baseline, setBaseline] = useState<SessionBaseline | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    void (async () => {
      const previous = await getSessionBaseline(workout).catch(() => null);
      if (!cancelled) setBaseline(previous);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, workout]);

  const logged = insights.workingSets > 0;

  return (
    <Sheet
      visible={visible}
      label="This session"
      closeLabel="Close session summary"
      onClose={onClose}
    >
      <SheetScrollView contentContainerStyle={styles.content}>
        {!logged ? (
          <EmptyState
            icon="analytics-outline"
            title="Nothing logged yet"
            description="Check off a set and this fills in: volume, reps, and where the work went."
          />
        ) : (
          <>
            <View style={styles.figures}>
              <Figure
                label="Volume"
                value={formatVolume(insights.volumeKg, weightUnit, { withUnit: false })}
                unit={weightUnit}
                progress={baseline ? compare(insights.volumeKg, baseline.volumeKg) : null}
                format={(diff) => formatVolume(diff, weightUnit)}
              />
              <Figure
                label="Reps"
                value={String(insights.reps)}
                progress={baseline ? compare(insights.reps, baseline.reps) : null}
                format={(diff) => String(diff)}
              />
              {/* "Working sets", not "Sets": the masthead behind this drawer
                  counts every row in the session, warm-ups and unfinished ones
                  included, and two figures both labelled Sets that disagree by
                  four is worse than no second figure at all. */}
              <Figure
                label="Working sets"
                value={String(insights.workingSets)}
                progress={baseline ? compare(insights.workingSets, baseline.sets) : null}
                format={(diff) => String(diff)}
              />
            </View>

            {baseline && (
              <Text variant="caption" color="textTertiary">
                {describeBaseline(baseline)}
              </Text>
            )}

            <Divider style={styles.rule} />

            <Text variant="overline" color="textTertiary">
              Muscles worked
            </Text>

            <SessionBodyMap
              sets={insights.setsByMuscle}
              width={sheetLayout.width - spacing.xl * 2}
              maxHeight={220}
            />

            <View style={styles.breakdown}>
              {insights.muscles.map((entry) => (
                <MuscleRow key={entry.muscle} entry={entry} />
              ))}
            </View>

            {/* Says why the bars add up to more than the set count above them,
                which is the first thing anyone notices here. The same question
                the body-distribution screen answers in its own footnote. */}
            <Text variant="caption" color="textTertiary">
              {footnote(insights)}
            </Text>
          </>
        )}
      </SheetScrollView>
    </Sheet>
  );
}

/**
 * One headline figure and where it stands against last time.
 *
 * The delta is a separate line rather than a suffix because it is a different
 * kind of statement: the figure is a fact about today and the delta is a
 * comparison, and running them together ("4,820 kg +380") reads as one number
 * with something stuck on the end.
 */
function Figure({
  label,
  value,
  unit,
  progress,
  format,
}: {
  label: string;
  value: string;
  unit?: string;
  progress: Progress | null;
  /** Renders the absolute difference in the figure's own unit. */
  format: (diff: number) => string;
}) {
  const colors = useColors();

  return (
    <View style={styles.figure}>
      <Text variant="overline" color="textTertiary" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="numericLarge" numberOfLines={1}>
        {value}
        {unit ? <Text variant="caption" color="textTertiary">{` ${unit}`}</Text> : null}
      </Text>

      {/*
        Ahead is the only state that gets a colour.

        Three sets into a session every total is below the last one's, and
        painting all three red would be telling someone they are failing at a
        workout they are two minutes into. Behind is the expected state and is
        stated plainly; clearing the bar is the event worth marking.

        Absent entirely when there is nothing to compare against, rather than
        held open by a blank line: all three figures share one baseline, so
        they gain and lose the row together and the grid stays level.
      */}
      {progress && (
        <Text
          variant="caption"
          numberOfLines={1}
          // A sign is punctuation, and punctuation is not spoken. Without this
          // the delta reads as a second bare number after the figure it is a
          // comparison against.
          accessibilityLabel={spokenDelta(progress, format)}
          style={{ color: progress.ahead ? colors.success : colors.textTertiary }}
        >
          {progress.diff === 0
            ? 'level'
            : `${progress.ahead ? '+' : '−'}${format(Math.abs(progress.diff))}`}
        </Text>
      )}
    </View>
  );
}

/** What the delta line announces, since "+380 kg" alone says nothing. */
function spokenDelta(progress: Progress, format: (diff: number) => string): string {
  if (progress.diff === 0) return 'level with last time';
  const amount = format(Math.abs(progress.diff));
  return progress.ahead ? `${amount} ahead of last time` : `${amount} short of last time`;
}

/**
 * One muscle's share of the session, as a bar and a count.
 *
 * The bar is proportional to the session rather than to any weekly target: see
 * `SessionBodyMap` for why a single workout has no landmark to be held to. The
 * widest bar is simply the muscle that got the most work today.
 */
function MuscleRow({ entry }: { entry: MuscleShare }) {
  const colors = useColors();
  const assisted = entry.directSets === 0;

  return (
    <View
      style={styles.muscleRow}
      accessible
      accessibilityLabel={`${MUSCLE_GROUP_LABELS[entry.muscle]}, ${formatSets(entry.sets)} sets${
        assisted ? ', assisting only' : ''
      }`}
    >
      <Text variant="label" numberOfLines={1} style={styles.muscleName}>
        {MUSCLE_GROUP_LABELS[entry.muscle]}
      </Text>

      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.fill,
            {
              // A muscle that was touched at all keeps a visible sliver: at 2%
              // of the session a true-to-scale bar is a single pixel, which
              // reads as an empty track beside a printed count.
              width: `${Math.max(6, entry.share * 100)}%`,
              backgroundColor: assisted ? colors.borderStrong : colors.accent,
            },
          ]}
        />
      </View>

      <Text variant="numeric" color={assisted ? 'textTertiary' : 'text'} style={styles.muscleValue}>
        {formatSets(entry.sets)}
      </Text>
    </View>
  );
}

/**
 * Why the bars below the map total more than the sets above them.
 *
 * The consequence is only stated when there is one. A session of movements that
 * name no assisting muscles (most cardio, most isolation work) credits nothing
 * indirectly, its bars add up to exactly the set count, and telling the reader
 * otherwise would send them looking for an error in numbers that are right.
 */
function footnote({ exercises, workingSets, weightedSets }: SessionInsights): string {
  const done = `${exercises} ${exercises === 1 ? 'exercise' : 'exercises'} so far.`;
  const rule =
    'A set counts once against the muscle it targets and half against each muscle that assists';

  return weightedSets > workingSets
    ? `${done} ${rule}, so the bars total more than the ${workingSets} sets logged.`
    : `${done} ${rule}.`;
}

/**
 * What the comparison is against, said plainly.
 *
 * The fallback case names itself as a fallback. "vs your last session" is a
 * weaker claim than "vs Push Day" and has to read as one, or a leg day measured
 * against yesterday's push day looks like a collapse in volume.
 */
function describeBaseline(baseline: SessionBaseline): string {
  const when = baseline.startedAt.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

  return baseline.match === 'recent'
    ? `Compared with your last session, ${when}`
    : `Compared with ${baseline.name}, ${when}`;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  figures: { flexDirection: 'row', alignItems: 'flex-start' },
  // Equal thirds, so the three figures sit on a grid rather than being spaced
  // to the width of their own digits: a volume that crosses 10,000 mid-session
  // must not shove the reps column sideways.
  figure: { flex: 1, gap: spacing.xs },
  rule: { marginTop: spacing.xs },
  breakdown: { gap: spacing.sm },
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // A third of the row, which fits every label in `MUSCLE_GROUP_LABELS` at
  // `label` size except "Trapezius", and that one truncates gracefully.
  muscleName: { width: '32%' },
  track: { flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  // Wide enough for "10.5", so the column of counts stays a column.
  muscleValue: { minWidth: 34, textAlign: 'right' },
});
