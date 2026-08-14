import { FlashList } from '@shopify/flash-list';
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Equipment,
  type MuscleGroup,
} from '@lift/shared';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Chip,
  Divider,
  EmptyState,
  FilterSelect,
  IconButton,
  Screen,
  SearchBar,
  Text,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises as exercisesTable } from '@/db/schema';
import { ExerciseRow } from '@/features/exercises/exercise-row';
import {
  exerciseListColumns,
  filterExercises,
  type ExerciseListItem,
} from '@/features/exercises/repository';
import { spacing, useColors } from '@/theme';

/** Hoisted: an inline arrow here is a new component type on every render, which
    remounts every separator in the list instead of reusing them. */
function ListSeparator() {
  return <Divider inset={70} />;
}

export default function ExercisesScreen() {
  const colors = useColors();

  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  // Live query: the list re-renders whenever the exercises table changes, so a
  // newly created custom exercise appears without any manual refetch. Only the
  // columns a row draws are selected — see `exerciseListColumns`.
  const { data: allExercises = [] } = useLiveQuery(
    db
      .select(exerciseListColumns)
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  /*
   * Filtering runs against the *deferred* query, not the live one.
   *
   * Scoring 6,800 names is far too much work to finish between two keystrokes
   * on a mid-range phone, and doing it synchronously means every character
   * waits for the previous one's filter — the keyboard visibly falls behind.
   * `useDeferredValue` lets the TextInput commit at input priority and re-runs
   * the filter at transition priority, where React can abandon it the moment
   * another character arrives. The list lags the field by a frame or two under
   * fast typing, which is the correct trade: the field is what the eye tracks.
   */
  const deferredSearch = useDeferredValue(search);

  const visible = useMemo(
    () => filterExercises(allExercises, { search: deferredSearch, muscle, equipment }),
    [allExercises, deferredSearch, muscle, equipment],
  );

  // Facets come from the full library rather than the filtered view, so
  // choosing a muscle doesn't cause the equipment options to vanish. Counts
  // ride along because with ~6,800 exercises "Neck (9)" is worth knowing
  // before you tap into it.
  const facets = useMemo(() => {
    const muscles = new Map<MuscleGroup, number>();
    const equipmentTypes = new Map<Equipment, number>();

    for (const exercise of allExercises) {
      if (exercise.isArchived) continue;
      muscles.set(exercise.primaryMuscle, (muscles.get(exercise.primaryMuscle) ?? 0) + 1);
      equipmentTypes.set(exercise.equipment, (equipmentTypes.get(exercise.equipment) ?? 0) + 1);
    }

    return {
      muscles: [...muscles]
        .map(([value, count]) => ({ value, label: MUSCLE_GROUP_LABELS[value], count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      equipment: [...equipmentTypes]
        .map(([value, count]) => ({ value, label: EQUIPMENT_LABELS[value], count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [allExercises]);

  const hasFilters = search.length > 0 || muscle !== null || equipment !== null;

  const clearFilters = () => {
    setSearch('');
    setMuscle(null);
    setEquipment(null);
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
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              name="add"
              size={26}
              color={colors.accent}
              accessibilityLabel="Create custom exercise"
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
          <FilterSelect
            label="Muscle"
            value={muscle}
            options={facets.muscles}
            onChange={setMuscle}
          />
          <FilterSelect
            label="Equipment"
            value={equipment}
            options={facets.equipment}
            onChange={setEquipment}
          />
          {hasFilters && <Chip label="Clear" icon="close" onPress={clearFilters} />}
        </View>
      </View>

      <View style={styles.countRow}>
        <Text variant="caption" color="textTertiary">
          {visible.length} {visible.length === 1 ? 'exercise' : 'exercises'}
        </Text>
      </View>

      <FlashList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={ListSeparator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="No exercises found"
            description={
              hasFilters
                ? 'Try a different search or clear your filters.'
                : 'Your exercise library is empty.'
            }
          />
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
  countRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
