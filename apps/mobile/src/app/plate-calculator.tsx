import {
  calculatePlates,
  defaultPlates,
  formatWeight,
  fromDisplayWeight,
  type WeightUnit,
} from '@lift/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Divider, Screen, Text, TextField, useScrollEdge } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { fontSize, spacing } from '@/theme';

/**
 * Bars that exist, listed in the unit they were manufactured in.
 *
 * A kg gym stocks 20/15/10/7.5 and an lb gym stocks 45/35/15. Converting one
 * list into the other invents bars nobody owns: the single kg list used to be
 * shown to lb users as "44.1 lb", which is a 20 kg bar wearing a costume. The
 * chosen value is converted to storage (kg) at read time, so the chip labelled
 * 45 lb sets the bar to 45 lb exactly rather than to the nearest kilogram.
 */
const BAR_OPTIONS: Record<WeightUnit, readonly number[]> = {
  kg: [20, 15, 10, 7.5],
  lb: [45, 35, 15],
};

export default function PlateCalculatorScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);
  // The configured bar *is* the state — there is no local copy to drift from
  // it. Zustand reads synchronously, so tapping a chip repaints this frame and
  // the choice is still there the next time the screen opens, and for the plate
  // line printed under every barbell block during a session.
  const barKg = useSettings((state) => state.barWeightKg);
  const updateSetting = useSettings((state) => state.update);

  // Seeds the field, rather than controlling it: callers that already know the
  // weight (the plate line in an exercise block) pass it through so the number
  // does not have to be retyped, but from there the field is the user's.
  const { targetKg } = useLocalSearchParams<{ targetKg?: string }>();
  const seeded = Number(targetKg);
  const hasSeed = Number.isFinite(seeded) && seeded > 0;

  const [targetText, setTargetText] = useState(() =>
    hasSeed ? formatWeight(seeded, weightUnit, { withUnit: false }) : '100',
  );

  const inventory = useMemo(() => defaultPlates(weightUnit), [weightUnit]);
  const barOptions = useMemo(
    () => BAR_OPTIONS[weightUnit].map((display) => fromDisplayWeight(display, weightUnit)),
    [weightUnit],
  );

  const result = useMemo(() => {
    const entered = Number(targetText.replace(',', '.'));
    if (!Number.isFinite(entered) || entered <= 0) return null;
    return calculatePlates(fromDisplayWeight(entered, weightUnit), barKg, inventory);
  }, [targetText, barKg, weightUnit, inventory]);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Plate calculator' }} />

      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          label={`Target weight (${weightUnit})`}
          accessibilityLabel={`Target weight in ${weightUnit}`}
          value={targetText}
          onChangeText={setTargetText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          // A seeded target arrived because someone wanted to *read* the
          // loading, not edit it; raising the keypad over the answer would be
          // the screen arguing with the reason it was opened.
          autoFocus={!hasSeed}
        />

        <View style={styles.barRow}>
          <Text variant="label" color="textSecondary">
            Bar weight
          </Text>
          <View style={styles.choices}>
            {barOptions.map((option) => (
              <Chip
                key={option}
                label={formatWeight(option, weightUnit)}
                selected={Math.abs(barKg - option) < 0.01}
                // Vertical only, plus a leading sliver into the 8pt gap. The
                // chips are horizontal neighbours and the later sibling wins an
                // overlapping hit test, so symmetric slop here would hand the
                // 20 kg bar's right edge to the 15 kg chip.
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 0 }}
                onPress={() => updateSetting('barWeightKg', option)}
              />
            ))}
          </View>
        </View>

        {result && (
          <View style={styles.result}>
            <Text variant="overline" color="textSecondary">
              {`Per side · ${weightUnit}`}
            </Text>

            {result.belowBar ? (
              <Text variant="body" color="danger">
                Target is lighter than the bar itself.
              </Text>
            ) : result.plates.length === 0 ? (
              <Text variant="body" color="textSecondary">
                Empty bar — no plates needed.
              </Text>
            ) : (
              <View>
                <Divider />
                {result.plates.map((plate, index) => (
                  <Fragment key={plate.weightKg}>
                    {index > 0 && <Divider />}
                    <View
                      style={styles.plateRow}
                      accessible
                      accessibilityLabel={`${plate.perSide} × ${formatWeight(
                        plate.weightKg,
                        weightUnit,
                      )} per side`}
                    >
                      <Text variant="numericLarge" style={styles.plateFigure}>
                        {formatWeight(plate.weightKg, weightUnit, { withUnit: false })}
                      </Text>
                      <Text variant="numeric" color="textSecondary">
                        {`× ${plate.perSide}`}
                      </Text>
                    </View>
                  </Fragment>
                ))}
                <Divider />
              </View>
            )}
          </View>
        )}

        {result && (
          <View style={styles.summary}>
            <SummaryRow label="Loaded" value={formatWeight(result.achievedKg, weightUnit)} />
            <SummaryRow label="Bar" value={formatWeight(barKg, weightUnit)} />
            {/* Only appears when the target cannot be made, which is the whole
                announcement — a line reading "loadable" under every exact
                answer would be the screen talking for the sake of it. */}
            {!result.exact && !result.belowBar && (
              <SummaryRow
                label="Short by"
                value={formatWeight(Math.abs(result.remainderKg), weightUnit)}
                danger
              />
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <Text variant="numeric" color={danger ? 'danger' : 'text'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.xl },
  barRow: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  result: { gap: spacing.sm },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  // The denominations are the answer, and the question gets asked with the
  // phone on the floor and chalk on both hands, so they stay large — larger
  // than anything else on this screen, including the field they were derived
  // from. Ruled rather than boxed: elsewhere in the app a box means the thing
  // inside it can be pressed, and these are read, not touched. `numericLarge`
  // supplies the tabular figures that keep the column aligned.
  //
  // 32 rather than the 40 it was. This and the rest timer are the app's two
  // deliberately large readouts and they now agree on a size, which matters
  // because a lone 40px figure in an app whose next-largest number is 24 reads
  // as an oversight rather than as emphasis. Still legible at arm's length off
  // the floor, which is the only thing this size has to buy.
  plateFigure: { fontSize: fontSize.xxxl },
  summary: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
