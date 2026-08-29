/**
 * The two widget shells the dashboard grid is built from.
 *
 * A widget is a *tile*: an icon that says what it is, a body that carries the
 * one thing it is reporting, and a footer that names it. The shell owns the
 * chrome and nothing else, so what a widget shows is decided entirely by its
 * caller and two widgets never disagree about padding, radius or where the
 * action sits.
 *
 * The action is one object rather than three loose props. It used to be an
 * `actionIcon` plus an `onPressAction`, either of which rendered nothing on its
 * own: a caller that passed an icon and forgot the handler got a widget with a
 * silently missing button and no error anywhere. Bundling them means the type
 * checker asks for the label too, which is what an icon-only button needs and
 * what the loose form never got.
 */

import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { Text } from './text';
import { MIN_TOUCH_SIZE, radius, spacing, useColors } from '../../theme';
import { PressableScale } from './motion';

/**
 * The secondary control in a widget's corner.
 *
 * `label` is not optional. The control is a 16px glyph with no text beside it,
 * so it is unreadable to a screen reader without one, and there is no sensible
 * default to fall back on: "add" on the bodyweight tile and "open history" on
 * the session tile are the same chevron-ish affordance saying two things.
 */
export interface WidgetAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export interface WidgetProps extends Omit<ViewProps, 'style'> {
  title?: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  action?: WidgetAction;
  children?: ReactNode;
  style?: ViewStyle;
}

/**
 * The corner control, sized to the finger rather than to the glyph.
 *
 * The visible box is 24pt, because a larger one would read as a button parked
 * on a tile rather than as a quiet affordance in its corner. `hitSlop` makes up
 * the difference to `MIN_TOUCH_SIZE`, and it stays inside the widget's own `lg`
 * padding, so the enlarged target never reaches past the tile's edge into
 * whatever sits beside it in the grid.
 */
function ActionButton({ action }: { action: WidgetAction }) {
  const colors = useColors();
  const slop = (MIN_TOUCH_SIZE - ACTION_BOX) / 2;

  return (
    <PressableScale
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      style={styles.actionButton}
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
    >
      <Ionicons name={action.icon} size={16} color={colors.textSecondary} />
    </PressableScale>
  );
}

/*
 * Why a tile's subtitle is `textSecondary` and not the `textTertiary` every
 * other caption in the app uses.
 *
 * `textTertiary` is a documented AA failure in the light palette: 4.49:1 on a
 * card, 3.91:1 on a muted one, and `tokens.ts` explains at length why it cannot
 * be darkened without collapsing the neutral ramp from three tiers to two. It
 * ships with a contract instead. The token is "only ever used for text that
 * repeats something already stated in a higher tier (units beside a number,
 * placeholders, row hints) and never for the only copy of a fact".
 *
 * A tile's subtitle is always the only copy of a fact. When the reading was
 * taken, how long the session ran, how many of the last hundred days were
 * trained: none of it is restated anywhere else on the tile, and the tile is
 * the whole block. That is exactly the case the contract excludes, so these
 * subtitles were the one place in the app breaking it.
 *
 * `textSecondary` clears AA on every surface in all eight palettes. The tier
 * below the title still reads as the tier below it, because the separation
 * here was never carried by colour alone: `label` is a size up and a weight up
 * from `caption`.
 */

/** The label a whole tile announces, built from the two lines it prints. */
function tileLabel(title?: string, subtitle?: string): string | undefined {
  return [title, subtitle].filter(Boolean).join(', ') || undefined;
}

export function SquareWidget({
  title,
  subtitle,
  icon,
  onPress,
  action,
  children,
  style,
  ...props
}: WidgetProps) {
  const colors = useColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={tileLabel(title, subtitle)}
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
      hoverFill={colors.surfaceMuted}
      style={[styles.square, style]}
      scaleTo={0.97}
      {...props}
    >
      <View style={styles.squareHeader}>
        {/*
         * `textSecondary`, and a size down from the 24 it was.
         *
         * The icon says which tile this is; the body says what it currently
         * reads. At 24pt in the full text colour the category marker outweighed
         * both the figure under it and the title naming it, which put the
         * loudest mark on the least informative element on the tile.
         */}
        {/* A zero-width stand-in when there is no icon, so `space-between`
            still has two children and the action stays in the right-hand
            corner instead of sliding to the left one. */}
        {icon ? <Ionicons name={icon} size={20} color={colors.textSecondary} /> : <View />}
        {action ? <ActionButton action={action} /> : null}
      </View>

      <View style={styles.squareBody}>{children}</View>

      <View style={styles.squareFooter}>
        {title && (
          <Text variant="label" numberOfLines={1}>
            {title}
          </Text>
        )}
        {subtitle && (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
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
  action,
  children,
  style,
  ...props
}: WidgetProps) {
  const colors = useColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={tileLabel(title, subtitle)}
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
              <Ionicons name={icon} size={16} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.wideFooterText}>
            {title && (
              <Text variant="label" numberOfLines={1}>
                {title}
              </Text>
            )}
            {subtitle && (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {action ? <ActionButton action={action} /> : null}
      </View>
    </PressableScale>
  );
}

/** The action control's drawn box. The touch target is `MIN_TOUCH_SIZE`. */
const ACTION_BOX = 24;

const styles = StyleSheet.create({
  square: {
    aspectRatio: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  squareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Centred in a row held open to the control's height, which is what puts
    // the two on one optical line: the category icon is a 20pt glyph and the
    // action is a 16pt glyph in a 24pt box, so aligning their boxes at the top
    // leaves their centres two points apart. `minHeight` is also what keeps the
    // body starting at the same y on a tile with no icon and no action as on
    // one with both.
    alignItems: 'center',
    minHeight: ACTION_BOX,
  },
  actionButton: {
    width: ACTION_BOX,
    height: ACTION_BOX,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  squareBody: {
    flex: 1,
    justifyContent: 'center',
    // Left, not centred. The title and subtitle under it sit on the tile's
    // padding edge, and a centred figure over left-aligned type is the one
    // misalignment a tile this small cannot absorb.
    alignItems: 'flex-start',
  },
  squareFooter: {
    alignItems: 'flex-start',
    gap: 2,
  },
  wide: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 120,
    justifyContent: 'space-between',
  },
  wideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  wideFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // `minWidth: 0` under `flex: 1`: without it a long title pushes the action
    // control off the tile's right edge instead of ellipsising.
    flex: 1,
    minWidth: 0,
  },
  wideFooterText: { flex: 1, minWidth: 0 },
  wideIconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
