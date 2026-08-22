import { FlashList } from '@shopify/flash-list';
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Equipment,
  type MuscleGroup,
} from '@lift/shared';
import {
  buildTrainingIndex,
  countExercisesPerMuscle,
  filterExercises,
} from '@lift/shared/exercises';
import { asc, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Chip,
  Divider,
  EmptyState,
  FilterSelect,
  HeaderAction,
  Screen,
  SearchBar,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises as exercisesTable } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { ExerciseRow } from '@/features/exercises/exercise-row';
import { MuscleFilter } from '@/features/exercises/muscle-filter';
import {
  exerciseListColumns,
  trainingHistoryQuery,
  type ExerciseListItem,
} from '@/features/exercises/repository';
import { spacing } from '@/theme';

/** Hoisted: an inline arrow here is a new component type on every render, which
    remounts every separator in the list instead of reusing them. */
function ListSeparator() {
  return <Divider inset={70} />;
}

export default function ExercisesScreen() {
  const scrollEdge = useScrollEdge();

  const [search, setSearch] = useState('');
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  // Live query: the list re-renders whenever the exercises table changes, so a
  // newly created custom exercise appears without any manual refetch. Only the
  // columns a row draws are selected. See `exerciseListColumns`. `loaded` is
  // what keeps this screen from claiming the library is empty while the largest
  // query in the app is still running.
  const { rows: allExercises, loaded } = useRows(
    db
      .select(exerciseListColumns)
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  // What this person actually trains, which is what decides the order below.
  const { rows: history } = useRows(trainingHistoryQuery());
  const index = useMemo(() => buildTrainingIndex(history), [history]);

  /*
   * Filtering runs against the *deferred* query, not the live one.
   *
   * Scoring 6,800 names is far too much work to finish between two keystrokes
   * on a mid-range phone, and doing it synchronously means every character
   * waits for the previous one's filter. The keyboard visibly falls behind.
   * `useDeferredValue` lets the TextInput commit at input priority and re-runs
   * the filter at transition priority, where React can abandon it the moment
   * another character arrives. The list lags the field by a frame or two under
   * fast typing, which is the correct trade: the field is what the eye tracks.
   */
  const deferredSearch = useDeferredValue(search);

  const visible = useMemo(
    () =>
      filterExercises(
        allExercises,
        { search: deferredSearch, muscles, equipment },
        // Browsing then opens on the lifts this person actually trains rather
        // than on whatever the catalog files under "A".
        index.usage,
      ),
    [allExercises, deferredSearch, muscles, equipment, index],
  );

  // Facets come from the full library rather than the filtered view, so
  // choosing a muscle doesn't cause the equipment options to vanish. Counts
  // ride along because "Kettlebell (78)" is worth knowing before you tap into
  // it.
  const equipmentOptions = useMemo(() => {
    const counts = new Map<Equipment, number>();
    for (const exercise of allExercises) {
      if (exercise.isArchived) continue;
      counts.set(exercise.equipment, (counts.get(exercise.equipment) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({ value, label: EQUIPMENT_LABELS[value], count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allExercises]);

  const muscleCounts = useMemo(() => countExercisesPerMuscle(allExercises), [allExercises]);

  // Named off the *deferred* search, so the status line and the list always
  // describe the same set of rows.
  const criteria = useMemo(() => {
    const parts: string[] = [];
    const term = deferredSearch.trim();
    if (term.length > 0) parts.push(`"${term}"`);
    for (const muscle of muscles) parts.push(MUSCLE_GROUP_LABELS[muscle]);
    for (const item of equipment) parts.push(EQUIPMENT_LABELS[item]);
    return parts;
  }, [deferredSearch, muscles, equipment]);

  const hasFilters = criteria.length > 0;

  /*
   * The status line is the only place the app confirms that a filter or a
   * keystroke did anything. The list below just quietly becomes shorter.
   *
   * What it no longer says is how many exercises exist. "6,847 exercises" is
   * the catalog's fact, not the reader's: nobody opens this screen to find out
   * how big it is, and the number mostly announced how much scrolling stood
   * between them and one lift. Unfiltered, the line explains the ordering
   * instead: the one non-obvious thing about this list. Filtered, it names
   * what it filtered on and steps up a level of contrast, because at that point
   * it is an answer rather than a label.
   */
  const statusLine = hasFilters
    ? [`${visible.length} ${visible.length === 1 ? 'result' : 'results'}`, ...criteria].join(' · ')
    : index.usage.size > 0
      ? 'Your most-trained lifts first'
      : null;

  const clearFilters = () => {
    setSearch('');
    setMuscles([]);
    setEquipment([]);
  };

  // Stable identity, so `ExerciseRow`'s `memo` actually holds. A fresh arrow
  // here would change every visible row's props on every keystroke and defeat
  // the memo entirely.
  const openExercise = useCallback((exercise: ExerciseListItem) => {
    router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ExerciseListItem }) => (
      <ExerciseRow exercise={item} onPress={openExercise} />
    ),
    [openExercise],
  );

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Exercises',
          headerRight: () => (
            <HeaderAction
              icon="add"
              iconSize={24}
              label="Create custom exercise"
              onPress={() => router.push('/exercise/new')}
            />
          ),
        }}
      />

      <View style={styles.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder="Search exercises"
        />

        <View style={styles.filterRow}>
          <MuscleFilter values={muscles} onChange={setMuscles} counts={muscleCounts} />
          <FilterSelect
            label="Equipment"
            values={equipment}
            options={equipmentOptions}
            onChange={setEquipment}
          />
        </View>
      </View>

      {/* Clear sits beside the sentence describing what it would undo, rather
          than third in the filter row where it had to be found among the two
          controls that caused the filtering. The row holds its height whether
          or not the chip is in it, so the list doesn't step down the screen
          when a filter is applied. */}
      <View style={styles.statusRow}>
        {loaded && statusLine !== null && (
          <Text
            variant={hasFilters ? 'label' : 'caption'}
            color={hasFilters ? 'textSecondary' : 'textTertiary'}
            numberOfLines={1}
            style={styles.statusText}
          >
            {statusLine}
          </Text>
        )}
        {hasFilters && (
          // Asymmetric slop: nothing sits to the chip's right, and its left
          // neighbour is text, so the target can grow both ways without
          // stealing a tap from another control.
          <Chip
            label="Clear"
            icon="close"
            onPress={clearFilters}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: spacing.lg }}
          />
        )}
      </View>

      <FlashList
        {...scrollEdge.list}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={ListSeparator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          // Only once the query has answered. Drizzle seeds `data` to `[]`, and
          // this is the longest-running query in the app, so the unloaded frame
          // here is both the most visible and the most wrong.
          loaded ? (
            <EmptyState
              icon="search"
              title="No exercises found"
              description={
                hasFilters
                  ? 'Try a different search, or clear the filters.'
                  : 'Your exercise library is empty.'
              }
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // A long search term truncates rather than pushing Clear off the row.
  statusText: { flexShrink: 1, marginRight: spacing.sm },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Tall enough for the Clear chip, so the list below stays put.
    minHeight: 32,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
