import { Card, Reveal } from '@/components/ui';
import { SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingChoice } from '@/features/settings/rows';
import { ThemePicker } from '@/features/settings/theme-picker';
import { useSettings } from '@/store/settings';

/**
 * Sunday and Monday only.
 *
 * These are the two the world actually splits on, and `firstDayOfWeek` is typed
 * to match. A Saturday start exists in parts of the Middle East and North
 * Africa; it is not offered here because nothing else in the app: the weekly
 * streak, the history buckets. Would honour it, and a preference that only half
 * the screens obey is worse than one that isn't offered.
 *
 * Held as strings because that is what a picker's options are keyed by, and
 * mapped back to the 0 | 1 the store stores at the one call site below.
 */
type FirstDayChoice = '0' | '1';

const FIRST_DAY_OPTIONS: { value: FirstDayChoice; label: string }[] = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
];

export default function AppearanceSettingsScreen() {
  const themePreference = useSettings((state) => state.themePreference);
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);
  const update = useSettings((state) => state.update);

  return (
    <SettingsPage title="Appearance">
      {/* The tiles are the whole page above the fold, and no header sits over
          them: the screen is called Appearance and they are what it is. */}
      <Reveal>
        <Card style={settingsStyles.first}>
          <ThemePicker
            value={themePreference}
            onChange={(value) => update('themePreference', value)}
          />
        </Card>

        {/* Which column the calendar's grid opens on. Stored as a number
            because that is what `Date.getDay()` returns and what the grid
            rotates by; the two labels are the only forms a user ever sees. */}
        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingChoice
            icon="calendar-outline"
            label="Week starts on"
            options={FIRST_DAY_OPTIONS}
            // The cast is exact rather than convenient: `firstDayOfWeek` is
            // typed `0 | 1`, so its string form is `'0' | '1'` and nothing
            // else. TypeScript widens `String()` to `string` regardless.
            value={String(firstDayOfWeek) as FirstDayChoice}
            onChange={(value) => update('firstDayOfWeek', value === '1' ? 1 : 0)}
          />
        </Card>
      </Reveal>
    </SettingsPage>
  );
}
