import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import {
  controlHeight,
  font,
  fontSize,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  useColors,
  type Palette,
} from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

/** How far a header action fades under the thumb. Matches `IconButton`. */
const PRESSED_OPACITY = 0.6;

/** Role colours a header action is allowed to take. */
export type HeaderActionTone = 'accent' | 'danger' | 'success';

/**
 * How a header action is drawn.
 *
 * `plain` is a word or a glyph in the role colour — the right weight for
 * anything the user might do, and for everything destructive. `filled` is a
 * pill in the role colour, and it is reserved for the one action a screen
 * exists to complete: Finish on the logging screen, Save on the one in front of
 * it. One per header, or the emphasis stops meaning anything.
 */
export type HeaderActionVariant = 'plain' | 'filled';

/** The foreground a filled pill takes, per role. See `textOnAccent` in the tokens. */
const PILL_FOREGROUND: Record<HeaderActionTone, keyof Palette> = {
  accent: 'textOnAccent',
  danger: 'textOnDanger',
  success: 'textOnSuccess',
};

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
  /** Plain word or filled pill. See `HeaderActionVariant`. */
  variant?: HeaderActionVariant;
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
  variant = 'plain',
  side = 'right',
  disabled = false,
  style,
  ...rest
}: HeaderActionProps) {
  const colors = useColors();
  const filled = variant === 'filled';

  const color = disabled
    ? colors.textTertiary
    : filled
      ? colors[PILL_FOREGROUND[tone]]
      : colors[tone];

  const content = (
    <>
      {icon && <Ionicons name={icon} size={iconSize} color={color} />}
      {title !== undefined && (
        <Text variant="bodyMedium" numberOfLines={1} style={{ color }}>
          {title}
        </Text>
      )}
    </>
  );

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      // Header actions have no fill to darken, so they dim like the other
      // unfilled controls (see `IconButton`) rather than stepping to a pressed
      // surface, and they take the deeper scale for the same reason: a header
      // button is a word or a glyph with no box around it to watch shrink. A
      // filled pill has a fill, but it dims too: the press has to read at a
      // glance from a 32pt shape at the edge of the screen, and a colour step
      // that small is easy to miss where a dim is not.
      dimTo={PRESSED_OPACITY}
      scaleTo={PRESS_SCALE_SMALL}
      style={[
        styles.action,
        filled && styles.filledFrame,
        side === 'right' ? styles.growLeft : styles.growRight,
        style,
      ]}
      {...rest}
    >
      {filled ? (
        /*
         * The pill is an inner view rather than the pressable's own frame.
         * The frame is 44pt so a thumb can find it, and a 44pt pill in a 44pt
         * header touches both edges — so the target keeps its height and the
         * shape sits inside it at 32.
         */
        <View
          style={[
            styles.pill,
            { backgroundColor: disabled ? colors.surfaceMuted : colors[tone] },
          ]}
        >
          {content}
        </View>
      ) : (
        content
      )}
    </PressableScale>
  );
}

/**
 * The header options every navigator in the app shares.
 *
 * Both navigators used to set these separately and disagreed: the stack titled
 * its screens at 17/semibold and the tab bar titled its own at 20/bold, so
 * pushing from Home visibly shrank the title. Alignment disagreed too, because
 * the two platforms disagree — a native-stack title is centred on iOS and
 * left-aligned on Android — which meant the same screen looked like two
 * different apps depending on the phone.
 *
 * One title style, centred on both platforms, and the back control reduced to
 * its chevron: iOS otherwise labels it with the previous screen's title, so
 * "Personal records" turned into a back button wider than the title it sat
 * next to. Stack-only options (`contentStyle`, gestures) stay at the call site
 * — this is the set both navigators can take.
 */
export function headerOptions(colors: Palette) {
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerTitleStyle: { fontSize: fontSize.lg, ...font('bold'), color: colors.text },
    headerTitleAlign: 'center' as const,
    headerShadowVisible: false,
  };
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
  // A filled action carries its own 32pt shape, so the frame's padding drops to
  // what is left of 44 around it. `minHeight` above still holds the target.
  filledFrame: { paddingVertical: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  // These carry the alignment as well as the padding, because it has to face
  // the same way. `center` would put a 20pt glyph in the middle of the new 28pt
  // content box and pull it 4pt in from the screen edge; pushing it to the
  // outward end leaves it exactly where it renders today.
  growLeft: { paddingLeft: spacing.lg, justifyContent: 'flex-end' },
  growRight: { paddingRight: spacing.lg, justifyContent: 'flex-start' },
});
