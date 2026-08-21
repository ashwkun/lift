/**
 * What a bottom sheet becomes when the window stops being a phone.
 *
 * A sheet that rises from the bottom edge is a phone idiom and a good one: the
 * bottom of a phone is where the thumb already is, and the edge it grows from is
 * the edge it will be dismissed towards. Both halves of that are false on a
 * desktop. The bottom of a 1440×900 window is nowhere near the pointer, the
 * sheet arrives hundreds of pixels from whatever was clicked to open it, and a
 * panel welded to the bottom edge of a monitor with a dimmed screen above it is
 * the single clearest tell that a phone layout has been dropped into a browser.
 *
 * So past `breakpoint.medium` the same component centres itself and closes its
 * bottom corners, which is what every desktop dialog does — including the four
 * this app already had (`PromptModal`, `DialogHost`, the measurement entry sheet
 * and the rest-duration sheet were all centred from the start, because they were
 * written as dialogs rather than as sheets).
 *
 * Returned as style objects to append rather than as a wrapper component. The
 * three sheets that need this each own a `Modal`, a backdrop `Pressable` that
 * dismisses, and an inner `Pressable` that swallows the tap — a wrapper would
 * have to reproduce all of that and the accessibility handling around it, where
 * two style overrides slot into what is already there.
 */

import { StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useLayout } from '@/theme';

/**
 * The same 400 the app's existing dialogs use.
 *
 * Deliberately not wider just because these carry lists. 400 is roughly a phone,
 * which is the width every one of these sheets was designed and tested at, and a
 * muscle-group filter stretched to 700 would put its chips in one long line
 * instead of the block they are meant to read as.
 */
const SHEET_MAX_WIDTH = 400;

export interface SheetLayout {
  /** Append to the backdrop's style. Moves the sheet off the bottom edge. */
  backdrop: ViewStyle | undefined;
  /** Append to the sheet's own style. Caps it and closes its bottom corners. */
  sheet: ViewStyle | undefined;
  /**
   * The safe-area padding this sheet should add below its content, which is the
   * home indicator's inset while it is docked and zero once it is not.
   *
   * A docked sheet has to clear the gesture pill because it is sitting on top of
   * it. A centred one is nowhere near the bottom of the screen, and keeping the
   * inset there would open a band of dead space under the buttons of every
   * dialog — on a device where the value is 34, a third of the gap between the
   * last control and the sheet's edge, for nothing.
   */
  bottomInset: number;
  /**
   * How wide the sheet itself ends up, in points, before its own padding.
   *
   * For the one thing inside a sheet that has to be handed a width rather than
   * filling one: the body map in the muscle filter, which draws into an SVG.
   * It was sized from the window, which is the same width the sheet had while
   * the sheet was the width of a phone — and is four times too wide the moment
   * the sheet becomes a 400pt dialog in the middle of a monitor.
   */
  width: number;
}

const wide = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  sheet: {
    // Restated because a centred backdrop no longer stretches its child. Without
    // it the sheet shrinks to the width of its widest row.
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    // Only the bottom two. The top corners are already `radius.xl` on every
    // sheet that needs this, and `borderRadius` would not override them anyway —
    // React Native resolves the specific corner properties over the shorthand,
    // so a blanket `borderRadius` here would round the bottom and be silently
    // ignored at the top.
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
});

export function useSheetLayout(): SheetLayout {
  const { isWide, width } = useLayout();
  const insets = useSafeAreaInsets();

  // `undefined` rather than an empty object on a phone, so the style arrays at
  // the call sites flatten to exactly what they were before this existed.
  return isWide
    ? {
        backdrop: wide.backdrop,
        sheet: wide.sheet,
        bottomInset: 0,
        // Mirrors the two rules above it: the backdrop's padding comes off the
        // window, and what is left is capped. Both have to be accounted for —
        // in a window narrower than 448 the padding binds before the cap does.
        width: Math.min(width - spacing.xxl * 2, SHEET_MAX_WIDTH),
      }
    : {
        backdrop: undefined,
        sheet: undefined,
        bottomInset: insets.bottom,
        // Docked, the sheet spans the screen — which is what the window is.
        width,
      };
}
