import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  TRACKING_TYPES,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from '@ironlog/shared';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, SectionHeader, Text, TextField } from '@/components/ui';
import { createCustomExercise } from '@/features/exercises/repository';
import { spacing } from '@/theme';

const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Weight & Reps',
  bodyweight_reps: 'Bodyweight Reps',
  weighted_bodyweight: 'Weighted Bodyweight',
  assisted_bodyweight: 'Assisted Bodyweight',
  duration: 'Duration',
  distance_duration: 'Distance & Duration',
  weight_distance: 'Weight & Distance',
  reps_only: 'Reps Only',
};

export default function NewExerciseScreen() {
  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<Equipment>('barbell');
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup>('chest');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);

    try {
      await createCustomExercise({ name, equipment, primaryMuscle, trackingType });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', (error as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'New Exercise',
          headerRight: () => (
            <Pressable onPress={() => void save()} disabled={!canSave} hitSlop={8}>
              <Text variant="bodyMedium" color={canSave ? 'accent' : 'textTertiary'}>
                Save
              </Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Cable Y-Raise"
          autoFocus
          maxLength={80}
        />

        <SectionHeader title="Tracking" />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Determines which fields you log for this exercise.
        </Text>
        <View style={styles.chips}>
          {TRACKING_TYPES.map((type) => (
            <Chip
              key={type}
              label={TRACKING_LABELS[type]}
              selected={trackingType === type}
              onPress={() => setTrackingType(type)}
            />
          ))}
        </View>

        <SectionHeader title="Equipment" />
        <View style={styles.chips}>
          {EQUIPMENT.map((item) => (
            <Chip
              key={item}
              label={EQUIPMENT_LABELS[item]}
              selected={equipment === item}
              onPress={() => setEquipment(item)}
            />
          ))}
        </View>

        <SectionHeader title="Primary Muscle" />
        <View style={styles.chips}>
          {MUSCLE_GROUPS.map((item) => (
            <Chip
              key={item}
              label={MUSCLE_GROUP_LABELS[item]}
              selected={primaryMuscle === item}
              onPress={() => setPrimaryMuscle(item)}
            />
          ))}
        </View>

        <Button
          title="Create Exercise"
          fullWidth
          size="lg"
          disabled={!canSave}
          loading={saving}
          onPress={() => void save()}
          style={styles.submit}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { marginBottom: spacing.sm },
  submit: { marginTop: spacing.xxl },
});
