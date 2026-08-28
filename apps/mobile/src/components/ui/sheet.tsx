/**
 * The app's drawer: one surface, two shapes.
 *
 * This chrome grew up inside `FilterSelect` and was called `FilterSheet`, but
 * most of what came to sit on it is not a filter: the list picker, the settings
 * pickers, and now the session drawer. The name was describing the first thing
 * built on it rather than the thing itself. What is here is the part every
 * drawer in the app shares: the modal, the backdrop, the grabber, the heading,
 * and the two ways out. `FilterSheet` is now a wrapper over it that supplies
 * filter wording, and nothing about how a filter behaves changed.
 *
 * Renders as two different surfaces on the split `useSheetIsDialog` owns: a
 * draggable `BottomSheetModal` docked to the bottom edge on a phone, and the
 * app's centred `Modal` dialog once the window is wide, or at any width on the
 * web, where the docked surface paints nothing at all. The
 * dialog is not given a drag handle of its own: `@gorhom/bottom-sheet` has no
 * centred-dialog mode to fall back on, and a drag-to-dismiss affordance means
 * nothing next to a mouse pointer, which is the same reasoning
 * `RestTimerSheet`'s decorative grabber already documents.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { useSheetIsDialog, useSheetLayout } from './sheet-layout';
import { Text } from './text';

/** How much of the window's height a docked sheet may fill before it scrolls
 *  internally. The same cap the wide dialog's `maxHeight: '80%'` already used. */
const MAX_DOCKED_HEIGHT_FRACTION = 0.8;

export interface SheetProps {
  visible: boolean;
  /** What this sheet is, set as the overline above its body. */
  label: string;
  onClose: () => void;
  /**
   * What the close button announces.
   *
   * Defaults to `Close {label}`, which is right for a drawer whose label names
   * a thing ("Session"). A filter's label names a *dimension*, so it overrides
   * this with "Close muscle filter" rather than "Close Muscle".
   */
  closeLabel?: string;
  /** A control beside the heading, e.g. a filter's "Clear". */
  action?: ReactNode;
  /** The sheet's scrollable body. */
  children: ReactNode;
  /**
   * Pinned below the scrollable body, e.g. a "Done" button.
   *
   * Its own slot rather than a second child stacked after the first: the
   * docked sheet measures its scrollable body and its footer as two
   * independent regions (`BottomSheetScrollView` and `BottomSheetFooter`)
   * so a short list still sizes to content with the footer pinned beneath
   * it, which a sibling folded into `children` cannot do: the sheet has no way
   * to tell where the scrollable part ends and the footer begins.
   */
  footer?: ReactNode;
}

export function Sheet({ visible, label, onClose, closeLabel, action, children, footer }: SheetProps) {
  const colors = useColors();
  const sheetLayout = useSheetLayout();
  const isDialog = useSheetIsDialog();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);

  // Bridges the boolean prop this component has always taken to the
  // imperative `present`/`dismiss` pair `BottomSheetModal` actually wants.
  // Only active once docked: while wide, `sheetRef` is never attached to
  // anything, so this is a no-op on that path.
  useEffect(() => {
    if (isDialog) return;
    if (visible) {
      console.log('Sheet is attempting to present...', { label });
      // Defer presentation to ensure BottomSheetModalProvider has registered the modal
      const timer = setTimeout(() => {
        console.log('Sheet present firing for', label, sheetRef.current ? 'has ref' : 'no ref');
        sheetRef.current?.present();
      }, 250);
      return () => clearTimeout(timer);
    } else {
      console.log('Sheet is dismissing...', { label });
      sheetRef.current?.dismiss();
    }
  }, [visible, isDialog, label]);

  // `BottomSheetModal` does not wire Android's hardware back button the way
  // RN's own `Modal` wires it to `onRequestClose` for free, so it is wired
  // here explicitly, and only while a docked sheet is actually open: two
  // sheets open in a row must not both react to one back press.
  useEffect(() => {
    if (isDialog || !visible) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isDialog, visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        style={[props.style, { backgroundColor: colors.overlay }]}
      />
    ),
    [colors.overlay],
  );

  // The heading plus the grabber pill: this is `handleComponent`, not a plain
  // child, because `enableDynamicSizing` tracks the handle's height as its own
  // field (`handleHeight`) separately from the scrollable body's, which is what
  // lets a short list size to content with the header still pinned above it.
  const renderHandle = useCallback(
    () => (
      <View accessibilityViewIsModal>
        <View style={styles.grabberRow}>
          <View
            style={[styles.grabber, { backgroundColor: colors.borderStrong }]}
            pointerEvents="none"
          />
        </View>
        <SheetHeading label={label} closeLabel={closeLabel} action={action} onClose={onClose} />
      </View>
    ),
    [colors.borderStrong, label, closeLabel, action, onClose],
  );

  // Same reasoning as the handle: a footer folded into the scrollable body
  // would be counted as part of its height rather than pinned beneath it.
  // `undefined` rather than always returning `BottomSheetFooter` so a sheet
  // with nothing to pin doesn't reserve space for one.
  const renderFooter = useMemo(
    () =>
      footer
        ? (props: BottomSheetFooterProps) => (
            <BottomSheetFooter
              {...props}
              bottomInset={insets.bottom}
              style={{ backgroundColor: colors.surfaceElevated }}
            >
              {footer}
            </BottomSheetFooter>
          )
        : undefined,
    [footer, insets.bottom, colors.surfaceElevated],
  );

  if (isDialog) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        {/*
          `accessible={false}` on both Pressables, deliberately.

          Pressable defaults to `accessible`, which collapses everything under
          it into one element, so the backdrop announced the entire sheet as a
          single button reading all 21 muscle groups in a row, and no option
          inside it could be reached. This is the control that gates every
          search on the exercise library, so it cannot be a blob.
        */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }, sheetLayout.backdrop]}
          onPress={onClose}
        >
          <View
            accessible={false}
            // Hides the list behind the sheet from VoiceOver, so focus lands on
            // the sheet's own heading when it opens and a swipe past the last
            // option comes back to it.
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                // Docked to the bottom edge, the footer would otherwise sit under
                // the gesture pill. Centred, there is no pill to clear: see
                // `bottomInset`.
                paddingBottom: spacing.md + sheetLayout.bottomInset,
              },
              sheetLayout.sheet,
            ]}
            onStartShouldSetResponder={() => true}
          >
            <SheetHeading
              label={label}
              closeLabel={closeLabel}
              action={action}
              onClose={onClose}
            />
            {children}
            {footer}
          </View>
        </Pressable>
      </Modal>
    );
  }

  const snapPoints = useMemo(() => ['CONTENT_HEIGHT'], []);

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      enablePanDownToClose
      enableDynamicSizing
      snapPoints={snapPoints}
      maxDynamicContentSize={Math.max(windowHeight, 800) * MAX_DOCKED_HEIGHT_FRACTION}
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      footerComponent={renderFooter}
      backgroundStyle={{
        backgroundColor: colors.surfaceElevated,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
      }}
    >
      {children}
    </BottomSheetModal>
  );
}

/**
 * The heading row, shared by both surfaces rather than written twice.
 *
 * It used to be duplicated: once inside `handleComponent` and once inline in
 * the wide dialog, which is two places for the same three controls to drift
 * apart.
 *
 * The close button is the sheet's only dismissal for anyone not using the
 * backdrop: tapping the dim area has no screen reader equivalent, and it is
 * also the part sighted users have to guess at.
 */
function SheetHeading({
  label,
  closeLabel,
  action,
  onClose,
}: Pick<SheetProps, 'label' | 'closeLabel' | 'action' | 'onClose'>) {
  const colors = useColors();

  return (
    <View style={styles.header}>
      <Text variant="overline" color="textTertiary" accessibilityRole="header" style={styles.flex}>
        {label}
      </Text>
      {action}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel ?? `Close ${label}`}
        onPress={onClose}
        hitSlop={HIT_SLOP}
        style={({ pressed }) => [
          styles.close,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export interface SheetActionProps {
  /** What the button reads. Kept short: it sits between a heading and a close. */
  title: string;
  /** What it announces, which usually names the sheet the heading already names. */
  accessibilityLabel: string;
  onPress: () => void;
}

/** The text button a sheet may put beside its heading. */
export function SheetAction({ title, accessibilityLabel, onPress }: SheetActionProps) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [
        styles.action,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Text variant="label" color="accent">
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    // Capped rather than sized to content: 21 muscle groups would otherwise
    // reach the status bar.
    maxHeight: '80%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.xl,
    // Shorter than the left: the close button carries its own inset, so the
    // full gutter would push it away from the edge the thumb reaches for.
    paddingRight: spacing.md,
    paddingBottom: spacing.sm,
  },
  flex: { flex: 1 },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  // 32 plus the standard 8pt slop is 48, and there is nothing pressable in any
  // direction for that slop to contest.
  close: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  // Stands in for `sheet`'s own `paddingTop` on the docked path, which has no
  // single wrapping card for that padding to live on: content, handle and
  // footer are three separately-measured regions there.
  grabberRow: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  grabber: { width: 36, height: spacing.xs, borderRadius: radius.pill },
});
