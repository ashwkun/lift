import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { HIT_SLOP, MIN_TOUCH_SIZE, radius, spacing, useColors, type Palette } from '@/theme';

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
  onRemove?: () => void;
}

export function Chip({ label, selected = false, icon, onRemove, ...rest }: ChipProps) {
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
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={HIT_SLOP} accessibilityLabel={`Remove ${label}`}>
          <Ionicons name="close" size={14} color={fg} />
        </Pressable>
      )}
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
// StatTile
// ---------------------------------------------------------------------------

export interface StatTileProps {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: Tone;
  style?: ViewStyle;
}

/**
 * One number with its label. Sits in a row of two or three (`flex: 1` each), so
 * the tiles share the width evenly however many there are.
 */
export function StatTile({ label, value, icon, tone = 'neutral', style }: StatTileProps) {
  const colors = useColors();
  const { fg } = toneColors(colors, tone);

  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {icon && (
        <View style={[styles.statIcon, { backgroundColor: toneColors(colors, tone).bg }]}>
          <Ionicons name={icon} size={15} color={fg} />
        </View>
      )}
      <Text variant="numeric" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" color="textTertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
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
}: ListRowProps) {
  const colors = useColors();
  const { fg, bg } = toneColors(colors, tone);

  return (
    <Pressable
      accessibilityRole="button"
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

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const colors = useColors();

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={30} color={colors.textTertiary} />
      </View>
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
  statTile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
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
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
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
