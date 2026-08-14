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

import { HIT_SLOP, MIN_TOUCH_SIZE, radius, spacing, useColors } from '@/theme';

import { Text } from './text';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps extends ViewProps {
  /** Adds internal padding. Disable when the card hosts its own list rows. */
  padded?: boolean;
  elevated?: boolean;
}

export function Card({ padded = true, elevated = false, style, ...rest }: CardProps) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
          borderColor: colors.border,
        },
        padded && styles.cardPadded,
        style,
      ]}
      {...rest}
    />
  );
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accentSurface : colors.surfaceMuted,
          borderColor: selected ? colors.accent : 'transparent',
        },
        pressed && styles.pressed,
      ]}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={14} color={selected ? colors.accent : colors.textSecondary} />}
      <Text variant="label" color={selected ? 'accent' : 'textSecondary'}>
        {label}
      </Text>
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={HIT_SLOP} accessibilityLabel={`Remove ${label}`}>
          <Ionicons name="close" size={14} color={selected ? colors.accent : colors.textSecondary} />
        </Pressable>
      )}
    </Pressable>
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
        pressed && styles.pressed,
        style,
      ]}
      {...rest}
    >
      <Ionicons name={name} size={size} color={color ?? colors.textSecondary} />
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

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
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
  iconButton: {
    minWidth: MIN_TOUCH_SIZE,
    minHeight: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: { opacity: 0.6 },
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
