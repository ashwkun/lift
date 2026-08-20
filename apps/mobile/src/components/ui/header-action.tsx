import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';

import { controlHeight, MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

import { Text } from './text';

/** Role colours a header action is allowed to take. */
export type HeaderActionTone = 'accent' | 'danger' | 'success';

export interface HeaderActionProps
  extends Omit<PressableProps, 'style' | 'children' | 'accessibilityLabel' | 'disabled'> {
  /** Dims the label and reports itself as disabled, rather than going silent. */
  disabled?: boolean;
  /**
   * What a screen reader announces. Required rather than optional because six
   * of the eight header buttons this replaces have no label at all and are read
   * as their visible word — two bare "Save"s, a "New", a "Finish" — which names
   * the verb and never its object. Name both: "Delete routine", not "Delete".
   */
  label: string;
  /** Visible text. Omit only when `icon` carries the action on its own. */
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  tone?: HeaderActionTone;
  /**
   * Which end of the header this sits at. The target grows towards the middle
   * of the header, so the label keeps the margin the native stack gave it.
   */
  side?: 'left' | 'right';
  style?: ViewStyle;
}

/**
 * A text or icon button in a native-stack header.
 *
 * Seven screens drew their own, each with its own padding and most with no
 * accessibility label, and all of them reached for `hitSlop={8}` to make up the
 * difference. Slop is the wrong tool here: the header is a native subview whose
 * bounds react-native-screens owns, and a touch landing outside the JS view's
 * frame is not reliably delivered to it — which is why the app's header buttons
 * are the hardest things in it to hit despite every one of them declaring slop.
 * So the 44pt comes from real padding on a real frame instead.
 *
 * The padding is asymmetric: it extends inwards, towards the title, into space
 * that is empty anyway. Outwards there is nothing to take — the native stack
 * sets the label's own margin from the screen edge, so padding that side moves
 * the label instead of growing the target. The width floor works the same way:
 * the content stays pinned to its outward edge and the frame reaches inwards to
 * make up the difference, so an icon-only button measures 44pt without its
 * glyph drifting off the line the back button and title sit on.
 */
export function HeaderAction({
  label,
  title,
  icon,
  iconSize = 20,
  tone = 'accent',
  side = 'right',
  disabled = false,
  style,
  ...rest
}: HeaderActionProps) {
  const colors = useColors();
  const color = disabled ? colors.textTertiary : colors[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        side === 'right' ? styles.growLeft : styles.growRight,
        pressed && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={iconSize} color={color} />}
      {title !== undefined && (
        <Text variant="bodyMedium" numberOfLines={1} style={{ color }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // Padding rather than slop, and the two floors under it so neither a short
    // glyph nor a narrow one can shrink the frame below the touch minimum. An
    // icon-only button has no text to supply width: at 20pt plus one side's
    // 16pt of padding it measured 36pt, which is where the two Delete buttons
    // in this app's headers were.
    paddingVertical: spacing.md,
    minHeight: controlHeight.md,
    minWidth: MIN_TOUCH_SIZE,
    // The native header container is 44pt, so a taller frame overflows it
    // rather than growing it — `iconSize={24}` alone would ask for 48.
    maxHeight: controlHeight.md,
  },
  // These carry the alignment as well as the padding, because it has to face
  // the same way. `center` would put a 20pt glyph in the middle of the new 28pt
  // content box and pull it 4pt in from the screen edge; pushing it to the
  // outward end leaves it exactly where it renders today.
  growLeft: { paddingLeft: spacing.lg, justifyContent: 'flex-end' },
  growRight: { paddingRight: spacing.lg, justifyContent: 'flex-start' },
  // Header actions have no fill to darken, so they dim like the other unfilled
  // controls (see IconButton) rather than stepping to a pressed surface.
  pressed: { opacity: 0.6 },
});
