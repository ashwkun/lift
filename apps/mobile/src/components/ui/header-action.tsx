import { Ionicons } from '@expo/vector-icons';
import { PixelRatio, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import {
  canHover,
  controlHeight,
  font,
  fontSize,
  letterSpacing,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  useColors,
  type Palette,
  type PaletteColor,
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
 * `plain` is a word or a glyph in the role colour: the right weight for
 * anything the user might do, and for everything destructive. `filled` is a
 * pill in the role colour, and it is reserved for the one action a screen
 * exists to complete: Finish on the logging screen, Save on the one in front of
 * it. One per header, or the emphasis stops meaning anything.
 */
export type HeaderActionVariant = 'plain' | 'filled';

/** The foreground a filled pill takes, per role. See `textOnAccent` in the tokens. */
const PILL_FOREGROUND: Record<HeaderActionTone, PaletteColor> = {
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
   * as their visible word (two bare "Save"s, a "New", a "Finish") which names
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
 * frame is not reliably delivered to it, which is why the app's header buttons
 * are the hardest things in it to hit despite every one of them declaring slop.
 * So the 44pt comes from real padding on a real frame instead.
 *
 * The padding is asymmetric: it extends inwards, towards the title, into space
 * that is empty anyway. Outwards there is nothing to take: the native stack
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

  // Only a plain action, only where there is a cursor, and never while
  // disabled: a dead control that lights up on approach is worse than one that
  // stays dark, because it invites the click it is about to ignore.
  const revealsFrame = canHover && !filled && !disabled;

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
      /*
       * Under a cursor, a plain action reveals the frame it already occupies.
       *
       * The whole point of this component is that the target is 44pt of real
       * padding rather than slop, and on a phone that is invisible and fine,
       * because a thumb aims at the word. A cursor aims at whatever looks
       * clickable, which for a bare "Save" is the five characters and not the
       * box around them. Tinting the frame on hover shows where the button
       * actually is.
       *
       * A filled action is left alone: it already draws a pill in a role colour,
       * so it is the one variant that is unmistakably a button at rest. Its
       * shape is an inner view rather than this frame anyway, so a fill here
       * would light the 44pt box *around* the 32pt pill.
       */
      fill={revealsFrame ? 'transparent' : undefined}
      fillPressed={revealsFrame ? colors.surfacePressed : undefined}
      hoverFill={revealsFrame ? colors.surfaceMuted : undefined}
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
         * header touches both edges, so the target keeps its height and the
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

export interface HeaderHeadingProps {
  /** The page's name: the same word the tab or the route is called by. */
  title: string;
  /**
   * One line under it, naming what the screen is currently showing: the week a
   * dashboard's figures cover, the range a chart is drawn over.
   *
   * Context, not a tagline. A screen with nothing to add here leaves it out and
   * renders as a plain title: filling it with a restatement of the title, or
   * with a sentence about what the tab is for, buys a second line of chrome on
   * every frame and answers nothing.
   */
  subtitle?: string;
}

/**
 * A header title with a second line under it.
 *
 * The three tabs are where this earns its place. Their headers were a single
 * word ("Home", "Workout", "Profile") repeating the label of the tab already
 * highlighted at the bottom of the same screen, which made the app's most-seen
 * piece of chrome the one that said the least. The second line is the part that
 * is not knowable from anywhere else: Home states a volume "this week" in type
 * an inch high and never once says which seven days that is.
 *
 * Rendered through `headerTitle` rather than `headerTitleStyle`, so the type
 * here has to match `headerOptions` by hand: the `display` variant's face and
 * tracking, resized to `MASTHEAD_SIZE`. Both sides read that constant, so the
 * size itself stays in step on its own; the face and the tracking are still
 * written down twice. Change one and change the other.
 *
 * The subtitle sits at `textSecondary` where a `ListRow`'s sits at
 * `textTertiary`, and the difference is not an oversight. The third tier is for
 * text that repeats something already said; this line is the only place the week
 * is stated, under a title twice the size of a row's, where 11px at the faintest
 * tier is not a quiet line but an unread one.
 */
export function HeaderHeading({ title, subtitle }: HeaderHeadingProps) {
  return (
    <View style={styles.heading}>
      {/* The role the platform's own header title carries, restated because
          replacing that component means replacing what it announced. */}
      <Text
        variant="display"
        style={styles.headingTitle}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {subtitle !== undefined && (
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/**
 * The masthead's size, and the leading that goes with it.
 *
 * Off the `fontSize` ladder on purpose: it is a step between `xxxl` (28, what
 * an in-content heading takes) and `display` (38, the token this used to take
 * whole), and it is a header-only size, so it lives here rather than in the
 * tokens where a call site could reach for it. The leading keeps `display`'s
 * ratio, near enough, so the tab headers' two lines sit where they did.
 *
 * Read by both places a masthead is drawn: `mastheadTitle`, for the titles the
 * navigator renders itself, and `HeaderHeading`, for the ones with a subtitle.
 */
const MASTHEAD_SIZE = 32;
const MASTHEAD_LINE_HEIGHT = 36;

/**
 * The masthead title: left at the margin, 32 in the display cut.
 *
 * The face and the tracking are the `display` variant's, which is Nuvio's
 * `pageDisplay`: -1.2 in the heaviest face the family ships. The size sits
 * under that token, 32 against its 38, which is the only part of the variant
 * this does not take verbatim: at 38 the title crowded the actions beside it,
 * and 32 still clears the 28 an in-content heading takes, so it is the largest
 * type on the screen. Against the margin this *is* the page's title rather than
 * a label on a bar above it. At 17 it read as chrome with the content's own
 * headings shouting past it, and at the 24 it sat at before that it was merely
 * the same size as an in-content heading, which says the page's name is worth
 * no more than the sections inside it.
 *
 * **Weight is at the family ceiling here and cannot go further.** `display` is
 * JetBrains Sans Bold, 700, and the family publishes nothing above it. If this
 * still needs more presence the levers are size and tracking, not weight; see
 * `fontFamily` in the tokens for why a heavier `fontWeight` would silently drop
 * the whole title back to the system face on Android.
 *
 * It only works left-aligned. Centred, a title is sized by whatever is left
 * after *both* ends have taken their share, so at this size the longest names
 * ("Leaderboard exercises", a workout the user called "Upper Body Heavy" beside
 * a Finish pill) truncate immediately. Against the margin it starts where every
 * other first line on the screen starts and has the whole width up to the
 * actions. That margin is what the jump from 24 to 32 spends, so the long names
 * above are the ones to check: `numberOfLines={1}` means they clip rather than
 * wrap, and the knob is `MASTHEAD_SIZE`.
 *
 * Exported because a stack screen with no back control opts back into it; see
 * `stackHeaderOptions`.
 */
export function mastheadTitle(colors: Palette) {
  return {
    headerTitleStyle: {
      fontSize: MASTHEAD_SIZE,
      ...font('display'),
      letterSpacing: letterSpacing.pageDisplay,
      color: colors.text,
    },
    headerTitleAlign: 'left' as const,
  };
}

/**
 * The header options every navigator in the app shares.
 *
 * Both navigators used to set these separately and disagreed: the stack titled
 * its screens at 17/semibold and the tab bar titled its own at 20/bold, so
 * pushing from Home visibly shrank the title. Alignment disagreed too, because
 * the two platforms disagree. A native-stack title is centred on iOS and
 * left-aligned on Android, which meant the same screen looked like two
 * different apps depending on the phone.
 *
 * So the alignment is stated rather than inherited, on both platforms. What it
 * is stated *as* now depends on the header: this base carries the masthead, and
 * the tab navigator is its only direct caller. Stack-only options
 * (`contentStyle`, gestures) stay at the call site.
 */
export function headerOptions(colors: Palette) {
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    ...mastheadTitle(colors),
    headerShadowVisible: false,
  };
}

/**
 * `headerOptions`, titled for a screen you can back out of.
 *
 * The split is the back chevron. A tab root is somewhere you *are*: its title is
 * the page's own heading, sitting on the same left margin as the content under
 * it, with a second line for context. A pushed screen is somewhere you went, and
 * its header is a bar with a way back in it. Centring the title over that
 * chevron is what tells the two apart at a glance, and it is the arrangement
 * both platforms use for the same distinction.
 *
 * The size comes down with the alignment, and it has to. See `mastheadTitle`:
 * a centred title is sized by what is left after both ends have taken their
 * share, and 32 in the display cut does not survive that next to a chevron and
 * an action. 18 in the semibold cut is the `subheading` variant, and it still
 * reads as the page's name rather than as chrome. The gap between the two is
 * now much wider than it was, which is the point: a masthead is the page, a
 * centred title is a label on a bar.
 *
 * Applied to the whole stack rather than per screen, because a back chevron is
 * something a stack screen has by default. The two that hide theirs (`sign-in`,
 * the post-workout summary: both are screens with no way back on purpose) spread
 * `mastheadTitle` in their own options to opt out, and each says why there.
 *
 * The failure mode to check when adding a screen is a truncated title: the
 * native stack ellipsises rather than wrapping, and a centred title is clipped
 * to the width left over once the wider of the two ends is mirrored on both
 * sides. `workout/active` is the tightest header in the app and the one to
 * measure against: a user-named workout between a chevron and a stopwatch glyph
 * plus a filled Finish pill leaves it roughly a third of the bar.
 */
export function stackHeaderOptions(colors: Palette) {
  return {
    ...headerOptions(colors),
    headerTitleStyle: {
      fontSize: fontSize.xl,
      ...font('semibold'),
      letterSpacing: -0.2,
      color: colors.text,
    },
    headerTitleAlign: 'center' as const,
  };
}

/**
 * Content height of a tab header, above the status bar.
 *
 * 64 is what React Navigation already gives every header on Android, so this
 * changes nothing there; on iOS it is 20pt more than the 44 a compact header
 * gets, which is the room a subtitle needs. The tab headers are the ones that
 * can spend it. They sit at the root of the app rather than on top of a screen
 * you are on your way back from, and iOS itself makes the same distinction with
 * its large titles.
 *
 * The height is set for all three tabs whether or not their header carries a
 * second line. Sizing each one to its own content would make switching tabs
 * move the top of the page.
 */
const TAB_HEADER_HEIGHT = 64;

/**
 * How far the header is allowed to grow with the system text size.
 *
 * A JS header takes a fixed number, so a box measured against the default text
 * size clips the moment someone turns theirs up, and a two-line title clips
 * twice as fast as a one-line one. Growing with the scale keeps both lines,
 * which is what the setting was turned up to achieve.
 *
 * Capped, because the scale is not: iOS goes past 3x, and a header taking a
 * third of the window is not an accessible header, it is a screen with no
 * content on it. Past the cap the title truncates, which is what it does
 * everywhere else in the app at that size.
 */
const TAB_HEADER_MAX_SCALE = 1.6;

/**
 * `headerOptions`, sized and inset for the tab navigator.
 *
 * Built on the base rather than on `stackHeaderOptions`, which is the whole
 * point of the split: a tab has no back chevron to centre a title over, and the
 * masthead is what the extra height and the subtitle line below exist for.
 *
 * Two things the stack gets from the platform and this header does not.
 *
 * The height is one: a JS header takes it from `headerStyle`, and the status bar
 * is drawn *inside* that box rather than added to it, so the inset has to be
 * part of the number.
 *
 * The right margin is the other, and it is the one that bites. A native-stack
 * header gives its buttons their own margin from the screen edge, which is why
 * `HeaderAction` pads inwards only, and would otherwise sit flush against the
 * glass here. The padding goes on the container rather than on the action, so
 * the action keeps a touch target that reaches in from an edge it is no longer
 * touching.
 */
export function tabHeaderOptions(colors: Palette, topInset: number) {
  return {
    ...headerOptions(colors),
    headerStyle: {
      backgroundColor: colors.background,
      height:
        topInset +
        TAB_HEADER_HEIGHT * Math.min(PixelRatio.getFontScale(), TAB_HEADER_MAX_SCALE),
    },
    headerRightContainerStyle: { paddingRight: spacing.lg },
  };
}

const styles = StyleSheet.create({
  // 2pt, not the 4 the mastheads use: at this size the two lines are one object
  // and the tighter set is what keeps them reading as a title with a caption
  // rather than as two stacked labels.
  heading: { gap: 2 },
  // The `display` variant at the masthead's size rather than the token's. See
  // `MASTHEAD_SIZE`: the face and the tracking come from the variant.
  headingTitle: { fontSize: MASTHEAD_SIZE, lineHeight: MASTHEAD_LINE_HEIGHT },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // Padding rather than slop, and the two floors under it so neither a short
    // glyph nor a narrow one can shrink the frame below the touch minimum. An
    // icon-only button has no text to supply width: at 20pt plus one side's
    // 16pt of padding it measured 36pt, which is where the two Delete buttons
    // in this app's headers were.
    paddingVertical: spacing.sm,
    minHeight: controlHeight.md,
    minWidth: MIN_TOUCH_SIZE,
    // Only ever seen on hover, where the frame is tinted. Without it the reveal
    // is a hard-edged rectangle in a header full of rounded shapes.
    borderRadius: radius.md,
    // The native header container is 44pt, so a taller frame overflows it
    // rather than growing it. `iconSize={24}` alone would ask for 48.
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
