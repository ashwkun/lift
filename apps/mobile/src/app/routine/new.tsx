import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Screen, TextField } from '@/components/ui';
import { createRoutine } from '@/features/routines/repository';
import { spacing } from '@/theme';

export default function NewRoutineScreen() {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const routine = await createRoutine({ name });
      // Replace rather than push: backing out of the editor should return to
      // the routines list, not to this naming step.
      router.replace({ pathname: '/routine/[id]', params: { id: routine.id } });
    } catch (error) {
      Alert.alert('Could not create routine', (error as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'New Routine' }} />

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
          title="Create Routine"
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
