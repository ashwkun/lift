import {
  ONE_REP_MAX_FORMULAS,
  ONE_REP_MAX_FORMULA_LABELS,
  estimateOneRepMax,
  formatWeight,
  fromDisplayWeight,
  trimZeros,
  type OneRepMaxFormula,
} from '@lift/shared';
import { useState } from 'react';

import { Card, Divider, PromptModal, Reveal } from '@/components/ui';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingChoice, SettingValue } from '@/features/settings/rows';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/**
 * The set the formula picker compares its options on.
 *
 * A one-rep max estimate is a ratio applied to the weight, so eight reps at 100
 * of *anything* returns the same figure in that same unit, which is why the
 * preview carries no unit and needs no conversion when someone switches to
 * pounds.
 *
 * Eight reps rather than five, and that is measured rather than chosen: at five,
 * Brzycki and O'Conner return exactly 112.5 and the preview would print two of
 * the six options as identical, which is the opposite of what it is there to
 * show. Eight is an ordinary working set and separates all six: 120.0 through
 * 127.7, which is the honest size of the decision being made.
 */
const FORMULA_REFERENCE = { weight: 100, reps: 8 } as const;

export default function CalculationsSettingsScreen() {
  const weightUnit = useSettings((state) => state.weightUnit);
  const oneRepMaxFormula = useSettings((state) => state.oneRepMaxFormula);
  const barWeightKg = useSettings((state) => state.barWeightKg);
  const update = useSettings((state) => state.update);

  const [editingBar, setEditingBar] = useState(false);

  return (
    <SettingsPage title="Calculations">
      <Reveal>
        <Card padded={false} style={settingsStyles.first}>
          <SettingChoice
            icon="analytics-outline"
            label="1RM formula"
            options={ONE_REP_MAX_FORMULAS.map((value) => ({
              value,
              label: ONE_REP_MAX_FORMULA_LABELS[value],
              description: formulaPreview(value),
            }))}
            value={oneRepMaxFormula}
            onChange={(value) => update('oneRepMaxFormula', value)}
          />
          <Divider inset={spacing.lg} />
          <SettingValue
            icon="barbell-outline"
            label="Bar weight"
            value={formatWeight(barWeightKg, weightUnit, { decimals: 1 })}
            hint="Opens a field to enter the weight of your barbell."
            onPress={() => setEditingBar(true)}
          />
        </Card>
        <Footnote>
          Estimates diverge past about 12 reps: all of these are population regressions, not
          measurements. The bar weight is what the plate line under each barbell exercise counts up
          from.
        </Footnote>
      </Reveal>

      <PromptModal
        visible={editingBar}
        title="Bar weight"
        message={`Entered in ${weightUnit}`}
        initialValue={formatWeight(barWeightKg, weightUnit, { withUnit: false })}
        placeholder="0"
        confirmLabel="Save"
        onCancel={() => setEditingBar(false)}
        onConfirm={(raw) => {
          setEditingBar(false);

          const parsed = Number(raw.replace(',', '.'));
          if (!Number.isFinite(parsed) || parsed <= 0) return;

          update('barWeightKg', fromDisplayWeight(parsed, weightUnit));
        }}
      />
    </SettingsPage>
  );
}

/**
 * What one formula makes of the reference set, as a line under its name.
 *
 * Six surnames is not a choice anybody can make. What separates them is how
 * hard each one extrapolates, and one worked example per option shows the whole
 * spread in the place the decision is actually taken, rather than describing it
 * in a footnote below the card.
 */
function formulaPreview(formula: OneRepMaxFormula): string {
  const { weight, reps } = FORMULA_REFERENCE;
  const estimate = estimateOneRepMax(weight, reps, formula);

  return `${weight} × ${reps} reps ≈ ${trimZeros(estimate.toFixed(1))}`;
}
