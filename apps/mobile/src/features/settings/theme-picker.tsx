/**
 * The theme choice, drawn rather than named.
 *
 * Every other choice on the settings screen is a word standing in for something
 * ("Brzycki", "Monday", "KG") and a word is the right control for those,
 * because the thing being chosen is not visual. This one is. "Dark" and
 * "Gruvbox" describe the palettes behind them about as well as a colour name
 * describes a paint chip, and the app already owns every palette as data, so it
 * can simply show them.
 *
 * The swatches are built from the real `Palette` objects rather than from
 * hardcoded hexes. That is the property worth protecting: change `background`
 * or `accent` in a palette and its tile changes with it, so the preview cannot
 * drift into advertising a theme the app no longer has. It is also what makes
 * adding a theme a one-line change here. The tile draws itself.
 */

import { Ionicons } from '@expo/vector-icons';
import { THEME_PREFERENCES, type ThemePreference } from '@lift/shared';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { hoverFill, radius, spacing, stroke, THEMES, useColors, type Palette } from '@/theme';

/**
 * Exported so the settings screen's summary band names the theme the same way.
 *
 * Every key in `THEME_PREFERENCES` needs one; the `Record` makes a missing
 * label a type error rather than an `undefined` caption.
 */
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  nord: 'Nord',
  gruvbox: 'Gruvbox',
  catppuccin: 'Catppuccin',
  spotify: 'Spotify',
  fitness: 'Fitness',
  solarized: 'Solarized',
};

/**
 * Roughly square, and deliberately not phone-shaped.
 *
 * A 9:19.5 rectangle at this size is a sliver, and three slivers in a row read
 * as a progress bar. Near-square, the tile reads as what it is: a swatch of a
 * palette, and leaves the bars inside it enough width to be distinguishable
 * from one another rather than from each other's noise.
 */
const TILE_ASPECT = 0.92;

export interface ThemePickerProps {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    // Named, because the group is the only thing on the card and the section
    // header above it is a separate element a reader may never reach: three
    // unlabelled radios reading "System, Light, Dark" could be anything.
    <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.picker}>
      {THEME_PREFERENCES.map((preference) => (
        <ThemeTile
          key={preference}
          preference={preference}
          selected={preference === value}
          onPress={() => {
            // Only when the palette actually swaps. Tapping the tile already
            // selected is a no-op, and a cue for it claims otherwise.
            if (preference !== value) haptics.selection();
            onChange(preference);
          }}
        />
      ))}
    </View>
  );
}

function ThemeTile({
  preference,
  selected,
  onPress,
}: {
  preference: ThemePreference;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${THEME_LABELS[preference]} theme`}
      onPress={onPress}
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
      hoverFill={hoverFill(colors.surface, colors.surfacePressed)}
      style={styles.tile}
    >
      {/*
        The ring is a frame around the swatch rather than a border on it: the
        swatch is a picture of another theme's canvas, and drawing this theme's
        accent directly onto its edge would put two palettes in contact with no
        margin between them. Unselected it is drawn in the card's own colour, so
        the tile keeps one size and nothing shifts when the selection moves:
        see `stroke` in the tokens.
      */}
      <View style={[styles.ring, { borderColor: selected ? colors.accent : colors.surface }]}>
        {preference === 'system' ? (
          <View style={styles.split}>
            {/* Light and dark, split down the middle. The seam is the point:
                "System" is not a theme of its own, it is those two deferred to
                whichever one the phone is in. It shows those two specifically
                because they are the only pair `system` ever resolves to: the
                named palettes below are chosen outright or not at all. */}
            <Swatch palette={THEMES.light.colors} style={styles.half} />
            <Swatch palette={THEMES.dark.colors} style={styles.half} />
          </View>
        ) : (
          <Swatch palette={THEMES[preference].colors} />
        )}
      </View>

      <View style={styles.caption}>
        {/*
          Always drawn, and hidden with opacity rather than with a condition.
          Mounting it only when selected would push the label sideways as the
          selection moved, so all three captions would shuffle on every tap. It
          is also the only part of the selected state that is not a colour, which
          is what it is for: on the light palette the accent is a deep olive, and
          a ring in it against a white card is a weaker signal than it is on
          black.
        */}
        <Ionicons
          name="checkmark-circle"
          size={14}
          color={colors.accent}
          style={selected ? undefined : styles.hidden}
        />
        <Text
          variant="label"
          numberOfLines={1}
          style={selected ? { color: colors.accent } : undefined}
        >
          {THEME_LABELS[preference]}
        </Text>
      </View>
    </PressableScale>
  );
}

/**
 * A miniature of the app: canvas, a title, a card with two lines in it, and the
 * one accent element the palette allows a view.
 *
 * Abstract on purpose. A faithful screenshot at 100pt is illegible, and the
 * question the tile has to answer is not "what does the home screen look like"
 * but "how dark is this, and what colour is the loud thing", which four
 * rectangles answer exactly.
 */
function Swatch({ palette, style }: { palette: Palette; style?: ViewStyle }) {
  return (
    <View style={[styles.swatch, { backgroundColor: palette.background }, style]}>
      <View style={[styles.title, { backgroundColor: palette.text }]} />
      <View style={[styles.card, { backgroundColor: palette.surface }]}>
        <View style={[styles.line, { backgroundColor: palette.textTertiary }]} />
        <View style={[styles.line, styles.lineShort, { backgroundColor: palette.textTertiary }]} />
      </View>
      <View style={[styles.pill, { backgroundColor: palette.accent }]} />
    </View>
  );
}

/**
 * Three across, wrapping.
 *
 * The tiles used to be `flex: 1` in a single row, which was right for three of
 * them and falls apart at eight: eight equal shares of a card is a row of
 * slivers, and the swatch inside each one stops being readable as a palette at
 * all. Three keeps the tile wide enough for its caption; "Catppuccin" is the
 * longest label and the one to check if this number ever changes.
 *
 * Sized as a percentage with a fixed gap rather than with `flex`, so the last
 * row lines its columns up with the ones above instead of stretching whatever
 * is left over across the full width. 31% × 3 plus two 8px gaps clears even a
 * narrow phone's card with room to spare, and the leftover grows rather than
 * shrinks on wider screens.
 */
const COLUMN_WIDTH = '31%';

const styles = StyleSheet.create({
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.md,
  },
  // Padded on all four sides so the pressed fill reads as a rounded rect around
  // the whole tile rather than as a band clipped to the swatch's width.
  tile: { width: COLUMN_WIDTH, gap: spacing.sm, borderRadius: radius.md, padding: spacing.xs },
  ring: {
    borderWidth: stroke.outline,
    borderRadius: radius.md,
    padding: 3,
    aspectRatio: TILE_ASPECT,
  },
  swatch: { flex: 1, gap: 4, padding: 6, borderRadius: radius.sm },
  split: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.sm,
    // The two halves are square-cornered pictures inside a rounded frame;
    // without this they poke out of its corners.
    overflow: 'hidden',
  },
  // Squared off where it meets its twin, so the seam is a straight line rather
  // than two facing curves, and tightened because each half has half the width
  // to spend on the same four rectangles.
  half: { borderRadius: 0, padding: 4, gap: 3 },
  title: { height: 5, width: '62%', borderRadius: 2.5 },
  card: { flex: 1, gap: 3, padding: 4, borderRadius: 4, justifyContent: 'center' },
  line: { height: 3, borderRadius: 1.5, opacity: 0.9 },
  lineShort: { width: '55%' },
  pill: { height: 6, width: '45%', borderRadius: 3 },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  hidden: { opacity: 0 },
});
