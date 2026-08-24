import { MUSCLE_GROUP_LABELS, type MuscleGroup } from '@lift/shared';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MuscleSelectMap, UNMAPPED_MUSCLES } from '@/components/charts/body-map';
import {
  Button,
  Chip,
  FilterSheet,
  FilterTrigger,
  SheetScrollView,
  Text,
  useSheetLayout,
} from '@/components/ui';
import { spacing } from '@/theme';

export interface MuscleFilterProps {
  /** Every selected muscle, in no particular order. */
  values: readonly MuscleGroup[];
  onChange: (values: MuscleGroup[]) => void;
  /** Matching exercises per muscle, shown on the chips that have no shape. */
  counts?: Partial<Record<MuscleGroup, number>>;
}

/**
 * The muscle filter, as a body rather than as a list of names.
 *
 * The list this replaced was 21 alphabetical rows: "Abductors" through
 * "Upper Back", which is a taxonomy, not a question anyone asks. People come
 * to this filter pointing at themselves, and the app already draws the figure
 * they would point at on the History tab. Reusing it means the same shape means
 * the same muscle wherever you meet it.
 *
 * Multi-select, because "shoulders and triceps" is one training decision rather
 * than two searches. The single-value filter made you run the query twice and
 * remember the first half of the answer.
 */
export function MuscleFilter({ values, onChange, counts }: MuscleFilterProps) {
  // The sheet's width, not the window's. They are the same thing on a phone and
  // nothing like it once the sheet becomes a centred dialog.
  const sheetLayout = useSheetLayout();
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => new Set(values), [values]);

  const toggle = (muscles: MuscleGroup[]) => {
    const next = new Set(selected);
    // A region is one control: if any part of it is on, the tap turns the whole
    // region off. Otherwise every muscle it covers goes on together.
    if (muscles.some((muscle) => next.has(muscle))) {
      for (const muscle of muscles) next.delete(muscle);
    } else {
      for (const muscle of muscles) next.add(muscle);
    }
    onChange([...next]);
  };

  return (
    <>
      <FilterTrigger
        label="Muscle"
        summary={summarise(values)}
        expanded={open}
        onPress={() => setOpen(true)}
      />

      <FilterSheet
        visible={open}
        label="Muscle"
        onClose={() => setOpen(false)}
        onClear={values.length > 0 ? () => onChange([]) : undefined}
        footer={
          <View style={styles.footer}>
            <Button title="Done" fullWidth onPress={() => setOpen(false)} />
          </View>
        }
      >
        <SheetScrollView contentContainerStyle={styles.content}>
          <MuscleSelectMap
            selected={selected}
            onToggle={toggle}
            width={sheetLayout.width - spacing.xl * 2}
            maxHeight={300}
          />

          {/* The three groups with nowhere to sit on a figure. Without them
              "Cardio" would be unreachable from a filter that claims to cover
              the library. */}
          <View style={styles.chips}>
            {UNMAPPED_MUSCLES.map((muscle) => (
              <Chip
                key={muscle}
                label={
                  counts?.[muscle] !== undefined
                    ? `${MUSCLE_GROUP_LABELS[muscle]} (${counts[muscle]})`
                    : MUSCLE_GROUP_LABELS[muscle]
                }
                selected={selected.has(muscle)}
                onPress={() => toggle([muscle])}
              />
            ))}
          </View>

          {/* Names what the shapes mean: the figures show *that* something is
              selected, not which muscle the tap actually landed on. */}
          <Text variant="caption" color="textTertiary" align="center">
            {values.length === 0
              ? 'Tap a muscle to filter'
              : values.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(' · ')}
          </Text>
        </SheetScrollView>
      </FilterSheet>
    </>
  );
}

/**
 * What the trigger reads.
 *
 * A single muscle names itself. Past that the pill has no room, and the count
 * is the part that matters. The names are one tap away in the sheet.
 */
function summarise(values: readonly MuscleGroup[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return MUSCLE_GROUP_LABELS[values[0]];
  return `Muscle · ${values.length}`;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  // Centred and wrapping: three chips fit one line on a phone, and a fourth
  // group would drop rather than scroll off the edge of a sheet.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
});
