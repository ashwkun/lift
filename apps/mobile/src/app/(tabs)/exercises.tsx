import { FlashList } from '@shopify/flash-list';
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Equipment,
  type MuscleGroup,
} from '@ironlog/shared';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Divider, EmptyState, IconButton, Screen, SearchBar, Text } from '@/components/ui';
import { db } from '@/db/client';
import { exercises as exercisesTable, type Exercise } from '@/db/schema';
import { ExerciseRow } from '@/features/exercises/exercise-row';
import { filterExercises } from '@/features/exercises/repository';
import { spacing, useColors } from '@/theme';

export default function ExercisesScreen() {
  const colors = useColors();

  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  // Live query: the list re-renders whenever the exercises table changes, so a
  // newly created custom exercise appears without any manual refetch.
  const { data: allExercises = [] } = useLiveQuery(
    db
      .select()
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  const visible = useMemo(
    () => filterExercises(allExercises, { search, muscle, equipment }),
    [allExercises, search, muscle, equipment],
  );

  // Facets come from the full library rather than the filtered view, so
  // selecting a muscle doesn't cause the other chips to vanish.
  const facets = useMemo(() => {
    const muscles = new Set<MuscleGroup>();
    const equipmentTypes = new Set<Equipment>();
    for (const exercise of allExercises) {
      if (exercise.isArchived) continue;
      muscles.add(exercise.primaryMuscle);
      equipmentTypes.add(exercise.equipment);
    }
    return {
      muscles: [...muscles].sort((a, b) =>
        MUSCLE_GROUP_LABELS[a].localeCompare(MUSCLE_GROUP_LABELS[b]),
      ),
      equipment: [...equipmentTypes].sort((a, b) =>
        EQUIPMENT_LABELS[a].localeCompare(EQUIPMENT_LABELS[b]),
      ),
    };
  }, [allExercises]);

  const hasFilters = search.length > 0 || muscle !== null || equipment !== null;

  const clearFilters = () => {
    setSearch('');
    setMuscle(null);
    setEquipment(null);
  };

  const openExercise = (exercise: Exercise) => {
    router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } });
  };

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
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {hasFilters && (
          <Chip label="Clear" icon="close" onPress={clearFilters} />
        )}
        {facets.muscles.map((item) => (
          <Chip
            key={`muscle-${item}`}
            label={MUSCLE_GROUP_LABELS[item]}
            selected={muscle === item}
            onPress={() => setMuscle(muscle === item ? null : item)}
          />
        ))}
        {facets.equipment.map((item) => (
          <Chip
            key={`equipment-${item}`}
            label={EQUIPMENT_LABELS[item]}
            selected={equipment === item}
            onPress={() => setEquipment(equipment === item ? null : item)}
          />
        ))}
      </ScrollView>

      <View style={styles.countRow}>
        <Text variant="caption" color="textTertiary">
          {visible.length} {visible.length === 1 ? 'exercise' : 'exercises'}
        </Text>
      </View>

      <FlashList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ExerciseRow exercise={item} onPress={openExercise} />}
        ItemSeparatorComponent={() => <Divider inset={70} />}
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
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  countRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
