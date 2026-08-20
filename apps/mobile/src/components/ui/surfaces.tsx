import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {
  font,
  fontSize,
  HIT_SLOP,
  MIN_TOUCH_SIZE,
  radius,
  spacing,
  useColors,
  type Palette,
} from '@/theme';

import { Text } from './text';

/** Role colours that a tinted surface can be built from. */
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'record' | 'neutral';

/**
 * Maps a tone to its foreground and its tinted background.
 *
 * Chips, badges and callouts all read from here, so a "record" badge is the
 * same gold in the history list, the summary screen and the PR sheet — they
 * used to each pick their own pairing inline.
 */
function toneColors(c: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'accent':
      return { fg: c.accent, bg: c.accentSurface };
    case 'success':
      return { fg: c.success, bg: c.successSurface };
    case 'warning':
      return { fg: c.warning, bg: c.warningSurface };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSurface };
    case 'record':
      return { fg: c.record, bg: c.recordSurface };
    case 'neutral':
      return { fg: c.textSecondary, bg: c.surfaceMuted };
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps extends ViewProps {
  /** Adds internal padding. Disable when the card hosts its own list rows. */
  padded?: boolean;
  elevated?: boolean;
  /** Makes the whole card tappable, with a pressed surface. */
  onPress?: () => void;
}

export function Card({ padded = true, elevated = false, onPress, style, ...rest }: CardProps) {
  const colors = useColors();

  const base: ViewStyle = {
    backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
    borderColor: colors.border,
  };

  // A tappable card gets a real pressed surface rather than a dimmed one. On
  // AMOLED a card is already close to the canvas, so dropping its opacity moves
  // it *towards* the background — the press reads as the card disappearing.
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          base,
          pressed && { backgroundColor: colors.surfacePressed },
          padded && styles.cardPadded,
          style,
        ]}
        {...(rest as PressableProps)}
      />
    );
  }

  return <View style={[styles.card, base, padded && styles.cardPadded, style]} {...rest} />;
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function Divider({ inset = 0, style }: { inset?: number; style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: inset }, style]} />
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function Chip({ label, selected = false, icon, ...rest }: ChipProps) {
  const colors = useColors();
  const fg = selected ? colors.accent : colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? colors.accentSurface
            : pressed
              ? colors.surfacePressed
              : colors.surfaceMuted,
          borderColor: selected ? colors.accent : 'transparent',
        },
      ]}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={14} color={fg} />}
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export interface BadgeProps {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

/** Small non-interactive marker: PR count, set type, sync status. */
export function Badge({ label, tone = 'neutral', icon, style }: BadgeProps) {
  const colors = useColors();
  const { fg, bg } = toneColors(colors, tone);

  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      {icon && <Ionicons name={icon} size={11} color={fg} />}
      <Text variant="caption" style={[styles.badgeLabel, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  /** Renders a circular filled background behind the glyph. */
  filled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  size = 22,
  color,
  filled = false,
  style,
  ...rest
}: IconButtonProps) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [
        styles.iconButton,
        filled && { backgroundColor: colors.surfaceMuted },
        // Unfilled icon buttons have no background to darken, so they keep the
        // opacity dip; filled ones step to the pressed surface like everything
        // else that has a fill.
        pressed && (filled ? { backgroundColor: colors.surfacePressed } : styles.pressed),
        style,
      ]}
      {...rest}
    >
      <Ionicons name={name} size={size} color={color ?? colors.textSecondary} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// StatBand
// ---------------------------------------------------------------------------

export interface StatFigure {
  label: string;
  value: string;
  /** Set apart from the figure — smaller, quieter, on the same baseline. */
  unit?: string;
  /** Renders in the accent. At most one per band; see the note below. */
  lead?: boolean;
}

export interface StatBandProps {
  items: StatFigure[];
  style?: ViewStyle;
}

/**
 * A row of figures, ruled rather than boxed.
 *
 * This replaces a row of tiles — rounded card, tinted circle, icon, number,
 * grey caption — which is the single most generic component in mobile design
 * and read as such. Three of them side by side, each in a different role
 * colour, also broke the palette's own rule: lime, amber and green are all
 * near-maximum saturation on a black canvas, and using them decoratively for
 * "workouts / streak / volume" spends every emphasis the app has on three
 * numbers that are not emphatic. `lead` exists so a band can promote *one*
 * figure, which is what the accent is for.
 *
 * What is left is the data. Labels sit above their figures, tracked and
 * uppercase, the way a table heads its columns; the figures are tabular so
 * they align down the row; units are set small and quiet so "184.2k" reads as
 * the number and "kg" as its annotation. Hairline rules above, below and
 * between are the whole chrome budget. The first label aligns to the screen's
 * left margin, so the band sits on the same grid as every section header
 * rather than floating in a card of its own.
 */
export function StatBand({ items, style }: StatBandProps) {
  const colors = useColors();

  // Three figures across a phone at 32px overflows the moment a volume reaches
  // six digits, so the type steps down as the band fills up rather than each
  // figure independently shrinking itself to fit — that is what made the old
  // tiles render their three numbers at three different sizes.
  const figureSize = items.length > 2 ? fontSize.xxl : fontSize.xxxl;

  return (
    <View style={[styles.statBand, { borderColor: colors.border }, style]}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.statColumn, index > 0 && styles.statColumnInner]}>
          {/* Absolute, so the rule sits *on* the column boundary and takes no
              width from the row — in flow it stole its own width plus its
              margin from every column but the first, and the columns stopped
              being equal. */}
          {index > 0 && <View style={[styles.statRule, { backgroundColor: colors.border }]} />}
          <Text variant="overline" color="textTertiary" numberOfLines={1}>
            {item.label}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.statValue,
              { fontSize: figureSize, color: item.lead ? colors.accent : colors.text },
            ]}
          >
            {item.value}
            {item.unit ? (
              <Text style={[styles.statUnit, { color: colors.textTertiary }]}>
                {` ${item.unit}`}
              </Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Splits a formatted measurement into figure and unit — "184.2k kg" becomes
 * `['184.2k', 'kg']`, "142" stays `['142', undefined]`.
 *
 * The formatters in `@lift/shared` return display-ready strings with the unit
 * already attached, which is right for a sentence and wrong for a column: the
 * band needs the two set at different sizes. Splitting here keeps that a
 * presentation concern rather than forcing every formatter to grow a variant.
 */
export function splitMeasure(text: string): [string, string | undefined] {
  const match = /^(.*\d.*?)\s+([^\s\d]+)$/.exec(text);
  return match ? [match[1]!, match[2]!] : [text, undefined];
}

// ---------------------------------------------------------------------------
// ListRow
// ---------------------------------------------------------------------------

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Tints the leading icon and its backing circle. */
  tone?: Tone;
  /** Replaces the trailing chevron. */
  accessory?: ReactNode;
  /** Hides the chevron without supplying an accessory. */
  showChevron?: boolean;
  onPress?: () => void;
  /**
   * Reaches whatever the accessory does.
   *
   * A row is one accessibility element, so a button rendered into `accessory` —
   * the routine list's Start, say — is swallowed by the row that contains it
   * and cannot be reached at all. Naming it as a custom action gives it back:
   * the row announces its title, the rotor offers "Start", and the screen keeps
   * the one-element reading order that makes the list scannable.
   */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

/**
 * The standard tappable row: optional leading icon, title over subtitle, and a
 * trailing chevron. Settings rows, recent workouts and routine entries were
 * three separate hand-rolled versions of this with three different paddings.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  tone = 'neutral',
  accessory,
  showChevron = true,
  onPress,
  accessibilityActions,
  onAccessibilityAction,
}: ListRowProps) {
  const colors = useColors();
  const { fg, bg } = toneColors(colors, tone);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        pressed && onPress ? { backgroundColor: colors.surfacePressed } : null,
      ]}
    >
      {icon && (
        <View
          style={[
            styles.listIcon,
            { backgroundColor: tone === 'neutral' ? colors.surfaceMuted : bg },
          ]}
        >
          <Ionicons name={icon} size={17} color={fg} />
        </View>
      )}

      <View style={styles.listBody}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {accessory ??
        (showChevron && onPress ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        ) : null)}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * The glyph used to sit in a 64px grey disc. The disc said nothing the icon did
 * not — it was there to give the icon a shape, and a grey circle floating above
 * centred text is the house style of every empty state ever auto-generated.
 * Naked and larger, at tertiary weight, it reads as a mark rather than a button
 * nobody can press.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const colors = useColors();

  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={38} color={colors.textTertiary} style={styles.emptyIcon} />
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {description && (
        <Text variant="body" color="textSecondary" align="center" style={styles.emptyDescription}>
          {description}
        </Text>
      )}
      {action && <View style={styles.emptyAction}>{action}</View>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

/**
 * Pass `title` in sentence case — the `overline` variant uppercases it in CSS.
 * Passing "QUICK START" here would be uppercased twice, which is invisible in
 * Latin but mangles locales with real case rules.
 */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="overline" color="textSecondary">
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardPadded: { padding: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeLabel: { fontWeight: '600' },
  iconButton: {
    minWidth: MIN_TOUCH_SIZE,
    minHeight: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: { opacity: 0.6 },
  statBand: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Equal columns, with the first flush to the screen margin so the band sits
  // on the same grid as the section headers above and below it.
  statColumn: { flex: 1, gap: spacing.xs, paddingRight: spacing.lg },
  statColumnInner: { paddingLeft: spacing.lg },
  statRule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  statValue: {
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  statUnit: {
    fontSize: fontSize.sm,
    ...font('medium'),
    letterSpacing: 0,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  listIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listBody: { flex: 1, gap: 2 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  emptyIcon: { marginBottom: spacing.sm, opacity: 0.75 },
  emptyDescription: { maxWidth: 300 },
  emptyAction: { marginTop: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
});
