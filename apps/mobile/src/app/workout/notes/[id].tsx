import { eq } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HeaderAction, Screen, Text, TextField } from '@/components/ui';
import { db } from '@/db/client';
import { touch, trackUpsertCoalesced } from '@/db/mutations';
import { workoutExercises } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { spacing } from '@/theme';

/**
 * Free-text note attached to one exercise within a session.
 *
 * The note is written as it is typed, not behind a Save button. A Save button on
 * a pushed screen is a trap on Android, where the system back gesture is how
 * people leave: the gesture never reaches the button, so a cue typed between
 * sets disappeared without a word. Persisting on every change and once more on
 * unmount means the only way to lose the text is to delete it.
 *
 * Per-keystroke writes are affordable for the same reason they are on the set
 * row: the rendered value is component state, so nothing waits on SQLite, and
 * `trackUpsertCoalesced` collapses the oplog entries a keystroke storm produces
 * back down to one.
 */
export default function ExerciseNotesScreen() {
  const { id, seed } = useLocalSearchParams<{ id: string; seed?: string }>();

  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // The row has been read, so a write is comparing against the real note rather
  // than against an empty field that has not loaded yet.
  const loadedRef = useRef(false);
  /**
   * What the database is believed to hold. `null` means unknown: before the
   * read lands, and after a write fails, and an unknown disk value can never
   * match, so the next change retries rather than assuming it got through.
   */
  const savedRef = useRef<{ value: string | null } | null>(null);
  // The current text, for the unmount save: a cleanup closure would otherwise
  // capture whatever `value` was when the effect was created.
  const valueRef = useRef('');
  /**
   * Whether the user has typed. Load-ordering depends on it, and so does the
   * recalled note: `seed` arrives from tapping last session's cue, which the
   * exercise block deliberately treats as a quotation. Leaving without touching
   * the field must not adopt it as today's note.
   */
  const touchedRef = useRef(false);
  /**
   * Saves run one after another rather than in parallel. Each one reads the row
   * back to build its oplog payload, so two overlapping writes can publish the
   * older text last. At typing speed the chain is never more than one deep.
   */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(
    (text: string, accepted = false) => {
      if (!loadedRef.current) return;
      if (!touchedRef.current && !accepted) return;

      const notes = text.trim() || null;
      if (savedRef.current?.value === notes) return;

      // Recorded before the write, not after, so a second keystroke arriving
      // while this one is in flight does not queue the same text twice.
      savedRef.current = { value: notes };

      chainRef.current = chainRef.current
        .then(async () => {
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

          setProblem(null);
        })
        .catch(() => {
          savedRef.current = null;
          haptics.rejected();
          setProblem('Not saved. This text has not reached the database. Typing again retries.');
        });
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [row] = await db
          .select()
          .from(workoutExercises)
          .where(eq(workoutExercises.id, id))
          .limit(1);

        if (cancelled) return;

        const stored = row?.notes ?? null;
        savedRef.current = { value: stored };
        loadedRef.current = true;

        // The field stays live while the read is in flight, so anything typed
        // in that window outranks what came back and is written straight after.
        if (touchedRef.current) {
          save(valueRef.current);
          return;
        }

        // A recalled cue only fills an exercise that has no note of its own;
        // a note written today always wins over a quotation from last week.
        const initial = stored ?? seed ?? '';
        valueRef.current = initial;
        setValue(initial);
      } catch {
        if (cancelled) return;
        // Nothing is written while `loadedRef` is false, so an unreadable row
        // stays unreadable rather than being overwritten by an empty field.
        setProblem('Could not read this note. Nothing typed here will be saved.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, seed, save]);

  // Covers every way out that isn't the Done button: the back gesture, the
  // back arrow, and the screen being torn down when the workout ends.
  useEffect(() => () => save(valueRef.current), [save]);

  const handleChange = (text: string) => {
    touchedRef.current = true;
    valueRef.current = text;
    setValue(text);
    save(text);
  };

  const handleDone = () => {
    // The only affirmative act on the screen, so it is also the one place a
    // recalled cue is adopted without being edited first.
    save(valueRef.current, true);
    router.back();
  };

  return (
    <Screen width="form">
      <Stack.Screen
        options={{
          title: 'Note',
          headerRight: () => (
            // "Done", not "Save": the text is already written by the time this
            // is reachable, so a Save label would promise work that is finished.
            //
            // Filled all the same. The screen is a single autofocused field with
            // the keyboard over the bottom half of it, so the header is the only
            // chrome on it and Done is the only thing in the header, and it is
            // the act that adopts a recalled cue, which backing out does not do.
            <HeaderAction
              label="Done editing note"
              title="Done"
              variant="filled"
              onPress={handleDone}
            />
          ),
        }}
      />

      <View style={styles.content}>
        <TextField
          value={value}
          onChangeText={handleChange}
          placeholder="Cues, tempo, how it felt…"
          accessibilityLabel="Exercise note"
          multiline
          autoFocus
          style={styles.input}
        />

        {/* The screen says nothing while a save is working. A "Saving…/Saved"
            line on a note this short is chatter, and it would be contradicted
            the moment a write actually failed. */}
        {problem && (
          <Text variant="label" color="danger">
            {problem}
          </Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  input: { height: 160, paddingTop: spacing.md, textAlignVertical: 'top' },
});
