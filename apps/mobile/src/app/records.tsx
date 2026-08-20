import { Ionicons } from '@expo/vector-icons';
import {
  formatDistance,
  formatDurationShort,
  formatVolume,
  formatWeight,
  PR_KIND_LABELS,
  PR_KINDS,
  type DistanceUnit,
  type PrKind,
  type WeightUnit,
} from '@lift/shared';
import { desc, eq, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Divider,
  EmptyState,
  PressableScale,
  Reveal,
  Screen,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises, personalRecords } from '@/db/schema';
import {
  resolveExerciseUnits,
  useAppUnits,
  type ExerciseUnitOverrides,
} from '@/features/exercises/units';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

interface ExerciseRecords {
  exerciseId: string;
  exerciseName: string;
  /**
   * The exercise's own unit overrides, carried through the query so each group
   * prints its record in the unit that exercise is logged in. A best bench of
   * "102.5 kg" under a heading the user only ever sees as 225 lb is a number
   * they have to convert to recognise as theirs. Null here means the exercise
   * has no opinion and follows the app-wide setting.
   */
  units: ExerciseUnitOverrides;
  records: { kind: PrKind; value: number; achievedAt: Date }[];
}

export default function RecordsScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();
  const appUnits = useAppUnits();
  const [grouped, setGrouped] = useState<ExerciseRecords[]>([]);
  const [loaded, setLoaded] = useState(false);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        try {
          const rows = await db
            .select({
              exerciseId: personalRecords.exerciseId,
              exerciseName: exercises.name,
              weightUnit: exercises.weightUnit,
              distanceUnit: exercises.distanceUnit,
              kind: personalRecords.kind,
              value: personalRecords.value,
              achievedAt: personalRecords.achievedAt,
            })
            .from(personalRecords)
            .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
            .where(isNull(personalRecords.deletedAt))
            .orderBy(desc(personalRecords.achievedAt));

          // Keep only the best entry per (exercise, kind).
          const byExercise = new Map<string, ExerciseRecords>();
          const seen = new Map<string, number>();

          for (const row of rows) {
            const key = `${row.exerciseId}:${row.kind}`;
            if ((seen.get(key) ?? 0) >= row.value) continue;
            seen.set(key, row.value);

            let entry = byExercise.get(row.exerciseId);
            if (!entry) {
              entry = {
                exerciseId: row.exerciseId,
                exerciseName: row.exerciseName,
                units: { weightUnit: row.weightUnit, distanceUnit: row.distanceUnit },
                records: [],
              };
              byExercise.set(row.exerciseId, entry);
            }

            const existing = entry.records.findIndex((record) => record.kind === row.kind);
            const next = { kind: row.kind, value: row.value, achievedAt: row.achievedAt };
            if (existing >= 0) entry.records[existing] = next;
            else entry.records.push(next);
          }

          // Kinds in their declared order rather than by date, so the heaviest
          // weight is the first figure under every exercise on the screen and the
          // column can be scanned rather than read.
          for (const entry of byExercise.values()) {
            entry.records.sort((a, b) => PR_KINDS.indexOf(a.kind) - PR_KINDS.indexOf(b.kind));
          }

          if (!cancelled) {
            setGrouped(
              [...byExercise.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName)),
            );
          }
        } catch {
          // A failed query counts as loaded, the same rule use-rows.ts applies:
          // a screen that never answers has to fall through to the empty state
          // rather than stay blank for the rest of the visit.
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The query answers a tick after mount and `grouped` is seeded to [], so the
  // empty state has to wait for it: otherwise every open of this screen starts
  // on "No records yet" and corrects itself a frame later, on a screen reached
  // from a row that promises records. Same rule as history.tsx and use-rows.ts.
  // The header stays mounted so the native title does not flash the route name.
  if (!loaded) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Personal records' }} />
      </Screen>
    );
  }

  if (grouped.length === 0) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Personal records' }} />
        <Reveal>
          <EmptyState
            icon="trending-up-outline"
            title="No records yet"
            description="A record is filed when a completed set beats your best on that exercise."
          />
        </Reveal>
      </Screen>
    );
  }

  const showsEstimated1rm = grouped.some((entry) =>
    entry.records.some((record) => record.kind === 'best_1rm'),
  );

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Personal records' }} />

      {/* Both branches above hold a bare header until the query answers, so
          whichever one wins arrives some way into the screen's life rather than
          with the push. The `Reveal` is what turns that into the page settling
          instead of a page appearing. */}
      <Reveal style={styles.flex}>
        {/*
          The record is the largest thing on the row, and everything that
          qualifies it — which record, which day — is set beneath it at caption
          size. This used to be a label-left / value-right list row, identical in
          weight to a settings toggle: the one screen in the app whose entire
          contents are worth being proud of read as a table of preferences. No
          badge and no medal either; the number is the achievement, and dressing
          it up would say the number is not enough.
        */}
        <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
          {showsEstimated1rm && (
            <Text variant="caption" color="textTertiary" style={styles.note}>
              An estimated 1RM is calculated from a set you completed, not a max you have tested.
            </Text>
          )}

          {grouped.map((entry, index) => (
            <View key={entry.exerciseId}>
              {index > 0 && <Divider inset={spacing.lg} />}

              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${entry.exerciseName}, exercise detail`}
                onPress={() =>
                  router.push({ pathname: '/exercise/[id]', params: { id: entry.exerciseId } })
                }
                // Full-bleed, so it highlights rather than scales — the same rule
                // `ListRow` follows. It crossfades from the canvas rather than
                // from `surface` because this list is unboxed: the records are
                // ruled off from each other, not carded.
                fill={colors.background}
                fillPressed={colors.surfacePressed}
                scaleTo={1}
                style={styles.header}
              >
                <Text
                  variant="overline"
                  color="textSecondary"
                  numberOfLines={1}
                  style={styles.flex}
                >
                  {entry.exerciseName}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </PressableScale>

              <View style={styles.records}>
                {entry.records.map((record) => {
                  const units = resolveExerciseUnits(entry.units, appUnits);
                  const measure = formatRecord(
                    record.kind,
                    record.value,
                    units.weightUnit,
                    units.distanceUnit,
                  );
                  const [figure, unit] = splitMeasure(measure);
                  const day = record.achievedAt.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  });

                  return (
                    <View
                      key={record.kind}
                      accessible
                      accessibilityLabel={`${PR_KIND_LABELS[record.kind]}, ${measure}, ${day}`}
                    >
                      <Text variant="numericLarge" color="record" numberOfLines={1}>
                        {figure}
                        {unit ? (
                          <Text variant="label" color="textTertiary">{` ${unit}`}</Text>
                        ) : null}
                      </Text>
                      <Text variant="caption" color="textTertiary">
                        {`${PR_KIND_LABELS[record.kind]} · ${day}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
              </View>
            ))}
        </ScrollView>
      </Reveal>
    </Screen>
  );
}

function formatRecord(
  kind: PrKind,
  value: number,
  unit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      // Stored in kilometres; printed in whichever unit the user set.
      return formatDistance(value, distanceUnit);
    case 'best_set_volume':
    case 'best_session_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  note: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    // The heading is the only way into the exercise from here, so it carries a
    // full touch target rather than the section header's own tight padding.
    minHeight: MIN_TOUCH_SIZE,
  },
  records: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  flex: { flex: 1 },
});
