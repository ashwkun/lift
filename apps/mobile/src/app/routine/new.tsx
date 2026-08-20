import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, TextField } from '@/components/ui';
import { createRoutine } from '@/features/routines/repository';
import { showAlert } from '@/store/dialog';
import { spacing } from '@/theme';

export default function NewRoutineScreen() {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  // The latch is the ref, not the state that dims the button: the return key
  // and the button can both fire inside one frame, and both would read `saving`
  // as false and create a routine.
  const inFlight = useRef(false);

  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);

    try {
      const routine = await createRoutine({ name });
      // Replace rather than push: backing out of the editor should return to
      // the routines list, not to this naming step.
      router.replace({ pathname: '/routine/[id]', params: { id: routine.id } });
    } catch (error) {
      void showAlert(
        'Could not create routine',
        error instanceof Error ? error.message : 'Nothing was saved.',
      );
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'New routine' }} />

      <View style={styles.content}>
        <TextField
          label="Routine name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Push Day A"
          autoFocus
          maxLength={60}
          onSubmitEditing={() => void create()}
          returnKeyType="done"
        />
        <Button
          title="Create routine"
          size="lg"
          fullWidth
          loading={saving}
          disabled={name.trim().length === 0}
          onPress={() => void create()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
});
