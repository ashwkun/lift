import {
  calculatePlates,
  defaultBarKg,
  defaultPlates,
  formatWeight,
  fromDisplayWeight,
  toDisplayWeight,
} from '@ironlog/shared';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, Chip, Screen, SectionHeader, Text, TextField } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

const BAR_OPTIONS_KG = [20, 15, 10, 7.5];

export default function PlateCalculatorScreen() {
  const colors = useColors();
  const weightUnit = useSettings((state) => state.weightUnit);

  const [targetText, setTargetText] = useState('100');
  const [barKg, setBarKg] = useState(() => defaultBarKg(weightUnit));

  const inventory = useMemo(() => defaultPlates(weightUnit), [weightUnit]);

  const result = useMemo(() => {
    const entered = Number(targetText.replace(',', '.'));
    if (!Number.isFinite(entered) || entered <= 0) return null;
    return calculatePlates(fromDisplayWeight(entered, weightUnit), barKg, inventory);
  }, [targetText, barKg, weightUnit, inventory]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Plate Calculator' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label={`Target weight (${weightUnit})`}
          value={targetText}
          onChangeText={setTargetText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          autoFocus
        />

        <View style={styles.barRow}>
          <Text variant="label" color="textSecondary">
            Bar weight
          </Text>
          <View style={styles.choices}>
            {BAR_OPTIONS_KG.map((option) => (
              <Chip
                key={option}
                label={formatWeight(option, weightUnit, { decimals: 1 })}
                selected={Math.abs(barKg - option) < 0.01}
                onPress={() => setBarKg(option)}
              />
            ))}
          </View>
        </View>

        {result && (
          <>
            <SectionHeader title="Per Side" />
            <Card style={styles.plateCard}>
              {result.belowBar ? (
                <Text variant="body" color="danger">
                  Target is lighter than the bar itself.
                </Text>
              ) : result.plates.length === 0 ? (
                <Text variant="body" color="textSecondary">
                  Empty bar — no plates needed.
                </Text>
              ) : (
                <View style={styles.plateList}>
                  {result.plates.map((plate) => (
                    <View
                      key={plate.weightKg}
                      style={[styles.plate, { backgroundColor: colors.accentSurface, borderColor: colors.accent }]}
                    >
                      <Text variant="numeric" color="accent">
                        {formatWeight(plate.weightKg, weightUnit, {
                          decimals: 2,
                          withUnit: false,
                        })}
                      </Text>
                      <Text variant="caption" color="textSecondary">
                        × {plate.perSide}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            <Card style={styles.summaryCard}>
              <SummaryRow
                label="Loaded"
                value={formatWeight(result.achievedKg, weightUnit, { decimals: 2 })}
              />
              <SummaryRow
                label="Bar"
                value={formatWeight(barKg, weightUnit, { decimals: 2 })}
              />
              {!result.exact && !result.belowBar && (
                <SummaryRow
                  label="Short by"
                  value={formatWeight(Math.abs(result.remainderKg), weightUnit, { decimals: 2 })}
                  danger
                />
              )}
            </Card>

            {!result.exact && !result.belowBar && (
              <Text variant="caption" color="textTertiary" style={styles.hint}>
                Not loadable with a standard plate set — {formatWeight(result.achievedKg, weightUnit, { decimals: 2 })}{' '}
                is the closest you can make.
              </Text>
            )}
          </>
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
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  barRow: { gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  plateCard: { minHeight: 80, justifyContent: 'center' },
  plateList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  plate: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: 72,
  },
  summaryCard: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { paddingHorizontal: spacing.xs },
});
