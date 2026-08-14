import { FlashList } from '@shopify/flash-list';
import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '@lift/shared';
import { asc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Divider,
  EmptyState,
  FilterSelect,
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
import { useExercisePicker } from '@/store/exercise-picker';
import { spacing } from '@/theme';

/** Hoisted so the list reuses separators instead of remounting them. */
function ListSeparator() {
  return <Divider inset={70} />;
}

/**
 * Multi-select exercise picker.
 *
 * Publishes the chosen ids to `useExercisePicker` rather than writing to the
 * database itself — the caller knows whether they're building a routine or
 * adding to a live workout, and this screen shouldn't.
 */
export default function ExercisePickerScreen() {
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  // A Set, not an array: `selected.includes(id)` ran once per rendered row on
  // every keystroke and every toggle. This screen opens mid-set, with the
  // keyboard already up — it is the most latency-sensitive list in the app.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const { data: allExercises = [] } = useLiveQuery(
    db
      .select(exerciseListColumns)
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  // Deferred for the same reason as the Exercises tab: the field must never
  // wait on a 6,800-row filter. See the note there.
  const deferredSearch = useDeferredValue(search);

  const visible = useMemo(
    () => filterExercises(allExercises, { search: deferredSearch, muscle }),
    [allExercises, deferredSearch, muscle],
  );

  const muscles = useMemo(() => {
    const counts = new Map<MuscleGroup, number>();
    for (const exercise of allExercises) {
      if (exercise.isArchived) continue;
      counts.set(exercise.primaryMuscle, (counts.get(exercise.primaryMuscle) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({ value, label: MUSCLE_GROUP_LABELS[value], count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allExercises]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      // `delete` reports whether it was there, so this is one lookup, not two.
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ExerciseListItem }) => (
      <ExerciseRow
        exercise={item}
        selectable
        selected={selected.has(item.id)}
        onPress={() => toggle(item.id)}
      />
    ),
    [selected, toggle],
  );

  const submit = useExercisePicker((state) => state.submit);

  const confirm = () => {
    if (selected.size === 0) return;
    // Publish before dismissing. Order matters: exercises are added in the
    // order the user picked them, which a Set preserves — re-selecting after a
    // deselect moves the id to the end, exactly as the array version did.
    submit([...selected]);
    router.back();
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

        <View style={styles.filters}>
          <FilterSelect label="Muscle" value={muscle} options={muscles} onChange={setMuscle} />
        </View>
      </View>

      <FlashList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={ListSeparator}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="No matches"
            description="Try a different search, or create a custom exercise."
          />
        }
      />

      {selected.size > 0 && (
        // The confirm bar is the lowest thing on screen, so it carries the
        // system navigation inset itself rather than padding the whole Screen
        // (which would leave a dead strip under the list when the bar is
        // hidden).
        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
          <Button
            title={`Add ${selected.size} ${selected.size === 1 ? 'Exercise' : 'Exercises'}`}
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
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { padding: spacing.lg },
});
