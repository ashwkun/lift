import { ListPicker } from '@/components/ui';

import { STAT_RANGES, type StatRange } from './windows';

export interface RangePickerProps {
  value: StatRange;
  onChange: (range: StatRange) => void;
  /** Narrow the offer. The set-count trend has no use for a single week. */
  options?: readonly StatRange[];
}

/**
 * The window every statistics screen is read through.
 *
 * Thin over `ListPicker`, which is the shared control: the import screen asks
 * the same shape of question about a different set of ranges, and two copies of
 * the sheet would be two places for the selected-row treatment to drift.
 */
export function RangePicker({ value, onChange, options }: RangePickerProps) {
  const available = options
    ? STAT_RANGES.filter((option) => options.includes(option.value))
    : STAT_RANGES;

  return <ListPicker label="Time range" options={available} value={value} onChange={onChange} />;
}
