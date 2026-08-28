import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { Text } from './text';
import { spacing, useColors } from '../../theme';
import { PressableScale } from './motion';

export interface WidgetProps extends Omit<ViewProps, 'style'> {
  title?: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  onPressAction?: () => void;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  children?: ReactNode;
  style?: ViewStyle;
}

export function SquareWidget({
  title,
  subtitle,
  icon,
  onPress,
  onPressAction,
  actionIcon,
  children,
  style,
  ...props
}: WidgetProps) {
  const colors = useColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
      hoverFill={colors.surfaceMuted}
      style={[styles.square, style]}
      scaleTo={0.97}
      {...props}
    >
      <View style={styles.squareHeader}>
        {icon ? (
          <Ionicons name={icon} size={24} color={colors.text} />
        ) : (
          <View style={styles.squareIconPlaceholder} />
        )}
        {actionIcon && onPressAction && (
          <PressableScale
            onPress={onPressAction}
            hitSlop={8}
            style={styles.actionButton}
            fill={colors.surface}
            fillPressed={colors.surfacePressed}
          >
            <Ionicons name={actionIcon} size={16} color={colors.textSecondary} />
          </PressableScale>
        )}
      </View>

      <View style={styles.squareBody}>{children}</View>

      <View style={styles.squareFooter}>
        {title && (
          <Text variant="label" numberOfLines={1}>
            {title}
          </Text>
        )}
        {subtitle && (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

export function WideWidget({
  title,
  subtitle,
  icon,
  onPress,
  onPressAction,
  actionIcon,
  children,
  style,
  ...props
}: WidgetProps) {
  const colors = useColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
      hoverFill={colors.surfaceMuted}
      style={[styles.wide, style]}
      scaleTo={0.98}
      {...props}
    >
      {children}
      <View style={styles.wideFooter}>
        <View style={styles.wideFooterLeft}>
          {icon && (
            <View style={[styles.wideIconBox, { borderColor: colors.border }]}>
              <Ionicons name={icon} size={16} color={colors.text} />
            </View>
          )}
          <View>
            {title && (
              <Text variant="label" numberOfLines={1}>
                {title}
              </Text>
            )}
            {subtitle && (
              <Text variant="caption" color="textTertiary" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {actionIcon && onPressAction && (
          <PressableScale
            onPress={onPressAction}
            hitSlop={8}
            style={styles.actionButton}
            fill={colors.surface}
            fillPressed={colors.surfacePressed}
          >
            <Ionicons name={actionIcon} size={16} color={colors.textSecondary} />
          </PressableScale>
        )}
      </View>
    </PressableScale>
  );
}

export function StatWidget({
  label,
  sublabel,
  value,
  unit,
  actionIcon,
  onPressAction,
  style,
}: {
  label: string;
  sublabel?: string;
  value: string;
  unit?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onPressAction?: () => void;
  style?: ViewStyle;
}) {
  const colors = useColors();

  return (
    <View style={[styles.statWidget, { backgroundColor: colors.surface }, style]}>
      <View style={styles.statLeft}>
        <Text variant="label" numberOfLines={1}>
          {label}
        </Text>
        {sublabel && (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {sublabel}
          </Text>
        )}
      </View>

      <View style={styles.statRight}>
        <Text variant="numericLarge">
          {value}
          {unit && (
            <Text variant="numeric" color="textSecondary">
              {' '}
              {unit}
            </Text>
          )}
        </Text>
        {actionIcon && onPressAction && (
          <PressableScale
            onPress={onPressAction}
            hitSlop={8}
            style={[styles.actionButton, { marginLeft: spacing.sm }]}
            fill={colors.surface}
            fillPressed={colors.surfacePressed}
          >
            <Ionicons name={actionIcon} size={16} color={colors.textSecondary} />
          </PressableScale>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 24,
    padding: spacing.lg,
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  squareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  squareIconPlaceholder: {
    width: 24,
    height: 24,
  },
  actionButton: {
    padding: spacing.xs,
    borderRadius: 8,
  },
  squareBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  squareFooter: {
    alignItems: 'flex-start',
    gap: 2,
  },
  wide: {
    width: '100%',
    borderRadius: 24,
    padding: spacing.lg,
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 120,
    justifyContent: 'space-between',
  },
  wideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  wideFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  wideIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statWidget: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 20,
    padding: spacing.lg,
    width: '100%',
  },
  statLeft: {
    flex: 1,
    gap: 2,
  },
  statRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
