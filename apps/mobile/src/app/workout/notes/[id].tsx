import { eq } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen, Text, TextField } from '@/components/ui';
import { db } from '@/db/client';
import { touch, trackUpsertCoalesced } from '@/db/mutations';
import { workoutExercises } from '@/db/schema';
import { spacing } from '@/theme';

/** Free-text note attached to one exercise within a session. */
export default function ExerciseNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [row] = await db
        .select()
        .from(workoutExercises)
        .where(eq(workoutExercises.id, id))
        .limit(1);

      if (!cancelled) {
        setValue(row?.notes ?? '');
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = async () => {
    const notes = value.trim() || null;
    await db
      .update(workoutExercises)
      .set({ notes, ...touch() })
      .where(eq(workoutExercises.id, id));

    const [updated] = await db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('workout_exercises', updated);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Notes',
          headerRight: () => (
            <Pressable onPress={() => void save()} hitSlop={8} disabled={!loaded}>
              <Text variant="bodyMedium" color="accent">
                Save
              </Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.content}>
        <TextField
          value={value}
          onChangeText={setValue}
          placeholder="Cues, tempo, how it felt…"
          multiline
          autoFocus
          style={styles.input}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
  input: { height: 160, paddingTop: spacing.md, textAlignVertical: 'top' },
});
