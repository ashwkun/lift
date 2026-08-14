import { FlashList } from '@shopify/flash-list';
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '@ironlog/shared';
import { asc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Divider, EmptyState, Screen, SearchBar, Text } from '@/components/ui';
import { db } from '@/db/client';
import { exercises as exercisesTable } from '@/db/schema';
import { ExerciseRow } from '@/features/exercises/exercise-row';
import { filterExercises } from '@/features/exercises/repository';
import { spacing } from '@/theme';

/**
 * Multi-select exercise picker.
 *
 * Returns the chosen ids to the previous screen as a route param rather than
 * writing to the database itself — the caller knows whether they're building a
 * routine or adding to a live workout, and this screen shouldn't.
 */
export default function ExercisePickerScreen() {
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const { data: allExercises = [] } = useLiveQuery(
    db
      .select()
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  const visible = useMemo(
    () => filterExercises(allExercises, { search, muscle }),
    [allExercises, search, muscle],
  );

  const muscles = useMemo(() => {
    const set = new Set<MuscleGroup>();
    for (const exercise of allExercises) {
      if (!exercise.isArchived) set.add(exercise.primaryMuscle);
    }
    return [...set].sort((a, b) => MUSCLE_GROUP_LABELS[a].localeCompare(MUSCLE_GROUP_LABELS[b]));
  }, [allExercises]);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const confirm = () => {
    if (selected.length === 0) return;
    // Order matters: exercises are added in the order the user picked them.
    router.back();
    router.setParams({ addedExerciseIds: selected.join(',') });
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Add Exercise',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text variant="bodyMedium" color="accent">
                Cancel
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/exercise/new')} hitSlop={8}>
              <Text variant="bodyMedium" color="accent">
                New
              </Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder="Search exercises"
          autoFocus
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {muscles.map((item) => (
          <Chip
            key={item}
            label={MUSCLE_GROUP_LABELS[item]}
            selected={muscle === item}
            onPress={() => setMuscle(muscle === item ? null : item)}
          />
        ))}
      </ScrollView>

      <FlashList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ExerciseRow
            exercise={item}
            selectable
            selected={selected.includes(item.id)}
            onPress={() => toggle(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <Divider inset={70} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="No matches"
            description="Try a different search, or create a custom exercise."
          />
        }
      />

      {selected.length > 0 && (
        <View style={styles.footer}>
          <Button
            title={`Add ${selected.length} ${selected.length === 1 ? 'Exercise' : 'Exercises'}`}
            fullWidth
            size="lg"
            onPress={confirm}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  filters: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
  footer: { padding: spacing.lg },
});
