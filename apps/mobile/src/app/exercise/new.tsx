import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  TRACKING_TYPES,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from '@lift/shared';
import { and, isNull, sql } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, type TextInput } from 'react-native';

import {
  Button,
  Chip,
  HeaderAction,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises } from '@/db/schema';
import { createCustomExercise } from '@/features/exercises/repository';
import { spacing } from '@/theme';

const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Weight & reps',
  bodyweight_reps: 'Bodyweight reps',
  weighted_bodyweight: 'Weighted bodyweight',
  assisted_bodyweight: 'Assisted bodyweight',
  duration: 'Duration',
  distance_duration: 'Distance & duration',
  weight_distance: 'Weight & distance',
  reps_only: 'Reps only',
};

/**
 * Why the name is checked before the insert rather than after it.
 *
 * The library is ~6,800 rows deep, so "Incline Press" already exists and the
 * user cannot know that from a text field. This used to insert first and report
 * the collision in an `Alert` afterwards — a modal that names a problem you
 * cannot see, dismissed onto a form you then have to re-read. The check runs on
 * blur and again before saving, and the reason is printed under the field it is
 * about, which is where the fix has to happen anyway.
 */
async function findConflict(name: string): Promise<{ name: string; isArchived: boolean } | null> {
  const [row] = await db
    .select({ name: exercises.name, isArchived: exercises.isArchived })
    .from(exercises)
    .where(and(isNull(exercises.deletedAt), sql`lower(${exercises.name}) = ${name.toLowerCase()}`))
    .limit(1);

  return row ?? null;
}

export default function NewExerciseScreen() {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment>('barbell');
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup>('chest');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  const [saving, setSaving] = useState(false);

  const nameField = useRef<TextInput>(null);

  /** Returns the reason the name is unusable, or null. */
  const checkName = async (): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give the exercise a name.';

    const conflict = await findConflict(trimmed);
    if (!conflict) return null;

    return conflict.isArchived
      ? `${conflict.name} already exists, archived. Unarchive it instead.`
      : `${conflict.name} already exists.`;
  };

  const validateName = async () => {
    // Nothing to say about a field the user has not filled in yet; the empty
    // case is worth raising only once they try to save. Nor about a blur caused
    // by the save itself, which is already running the same check.
    if (saving || !name.trim()) return;
    setNameError(await checkName());
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);

    const reason = await checkName();
    if (reason) {
      setNameError(reason);
      setSaving(false);
      nameField.current?.focus();
      return;
    }

    try {
      await createCustomExercise({ name, equipment, primaryMuscle, trackingType });
      router.back();
    } catch (error) {
      // Only a write that actually failed reaches here — a full disk, a locked
      // database. There is no field to hang that on, so it stays an alert.
      Alert.alert('Could not save', (error as Error).message);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'New exercise',
          headerRight: () => (
            <HeaderAction
              label="Save exercise"
              title="Save"
              disabled={saving}
              onPress={() => void save()}
            />
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          ref={nameField}
          label="Name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setNameError(null);
          }}
          onBlur={() => void validateName()}
          error={nameError ?? undefined}
          placeholder="e.g. Cable Y-raise"
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

        <SectionHeader title="Primary muscle" />
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

        {/* Not disabled on an empty name: a dead button states no reason, and
            the reason is the whole point. Pressing it names what is missing at
            the field and puts the cursor back in it. */}
        <Button
          title="Create exercise"
          fullWidth
          size="lg"
          disabled={saving}
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
