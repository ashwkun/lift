/**
 * A time of day, chosen rather than typed.
 *
 * This replaced a `PromptModal` that asked for "HH:mm" as free text. That is a
 * keyboard, a colon, a leading zero and a format the user has to be told about,
 * to answer a question with 1,440 possible answers that every phone already has
 * a control for. It also silently discarded anything that failed its regex, so
 * "5pm" and "5:00" both saved nothing and said nothing.
 *
 * Built in JS rather than pulling in `@react-native-community/datetimepicker`.
 * A native picker is one more module in the prebuild, it is unavailable in Expo
 * Go and on the web, and its two platform renderings look nothing like each
 * other or like this app. The wheel below is the same object on every target and
 * reads from the theme.
 *
 * The clock it offers follows the device: `prefersTwelveHourClock` decides
 * whether the hour column runs 12, 1, 2 … with an AM/PM control beside it, or
 * simply 00 through 23. The value crossing the boundary is always 24-hour
 * "HH:mm"; the 12-hour split exists only inside this file.
 */

import {
  parseClockTime,
  prefersTwelveHourClock,
  toClockTime,
  type ClockTime,
} from '@lift/shared';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityActionInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { haptics } from '@/features/feedback/haptics';
import { fontSize, radius, spacing, useColors } from '@/theme';

import { Button } from './button';
import { SegmentedControl } from './segmented-control';
import { Text } from './text';

/** Row height inside a wheel, and therefore the snap interval. */
const ITEM_HEIGHT = 40;

/**
 * Rows visible at once. Odd on purpose: the middle one is the selection, so an
 * even count would have the chosen value straddling the band.
 */
const VISIBLE_ROWS = 5;

const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
/** Blank space above the first row and below the last, so either can centre. */
const WHEEL_PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

/**
 * Wide enough for two tabular digits with room either side, and fixed rather
 * than sized to content: the columns have to stay put as the digits change, or
 * the colon between them walks back and forth while you scroll.
 */
const WHEEL_WIDTH = 64;

/** Falls back to 5pm, the same default the store ships. */
const FALLBACK: ClockTime = { hour: 17, minute: 0 };

const HOURS_24 = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
/**
 * 12 first, not last. The wheel is read as a clock face going forwards, and on a
 * 12-hour clock the hour after 11 is 12: putting it at the end would place the
 * two halves of the day's turn at opposite ends of the column. It also makes the
 * index the hour's position within its half, which is the whole conversion:
 * `hour24 = index + (pm ? 12 : 0)`.
 */
const HOURS_12 = ['12', ...Array.from({ length: 11 }, (_, index) => String(index + 1))];
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));

const MERIDIEM_OPTIONS = [
  { value: 'am' as const, label: 'AM' },
  { value: 'pm' as const, label: 'PM' },
];

/**
 * What a screen reader gets instead of a scroll gesture.
 *
 * A wheel is a swipe over a list whose rows are not individually focusable, so
 * without these it is an unlabelled dead end. `adjustable` is the role that maps
 * "swipe up / swipe down" onto these two actions.
 */
const ADJUST_ACTIONS: readonly AccessibilityActionInfo[] = [
  { name: 'increment', label: 'Later' },
  { name: 'decrement', label: 'Earlier' },
];

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------

interface WheelProps {
  /** Announced before the value, e.g. "Hour". */
  label: string;
  items: readonly string[];
  /** Read once, at mount. The wheel is uncontrolled after that; see below. */
  initialIndex: number;
  onChange: (index: number) => void;
}

/**
 * One scrolling column.
 *
 * Deliberately uncontrolled. A controlled wheel has to scroll itself whenever
 * the value it is given moves, and it is also the thing that moved the value, so
 * every settled scroll fires a programmatic scroll back into a list that is
 * still decelerating. It seeds from `initialIndex` and reports outwards only;
 * the modal remounts it on each open, which is where re-seeding happens.
 */
function Wheel({ label, items, initialIndex, onChange }: WheelProps) {
  const ref = useRef<ScrollView>(null);
  /** The last index reported out. Guards the haptic and the callback. */
  const settled = useRef(initialIndex);
  const seeded = useRef(false);
  /** Which row is under the band right now, including mid-fling. */
  const [active, setActive] = useState(initialIndex);

  const clamp = (index: number) => Math.min(Math.max(index, 0), items.length - 1);
  const indexAt = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    clamp(Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT));

  const settle = (index: number) => {
    setActive(index);
    if (index === settled.current) return;

    settled.current = index;
    haptics.selection();
    onChange(index);
  };

  const step = (delta: number) => {
    const next = clamp(settled.current + delta);
    if (next === settled.current) return;

    ref.current?.scrollTo({ y: next * ITEM_HEIGHT, animated: true });
    settle(next);
  };

  return (
    <View
      style={styles.wheel}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[active] }}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={(event) =>
        step(event.nativeEvent.actionName === 'increment' ? 1 : -1)
      }
    >
      <ScrollView
        ref={ref}
        // The wrapper above is the accessible element. Left visible, the rows
        // would also be reachable one by one, which is 60 stops for the minutes.
        importantForAccessibility="no-hide-descendants"
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={styles.wheelContent}
        // Not an effect: on Android the first layout has not landed when a mount
        // effect runs, so `scrollTo` there is a no-op and the wheel opens at
        // midnight. This fires once the rows have a height to scroll through.
        onContentSizeChange={() => {
          if (seeded.current) return;
          seeded.current = true;
          ref.current?.scrollTo({ y: initialIndex * ITEM_HEIGHT, animated: false });
        }}
        // Highlighting tracks the scroll; committing does not. Bailing out when
        // the row has not changed keeps this to one render per row crossed
        // rather than one per frame.
        onScroll={(event) => {
          const next = indexAt(event);
          setActive((current) => (current === next ? current : next));
        }}
        // Both, because a drag that stops without a fling never produces a
        // momentum event. When one does follow, it settles again on the final
        // row and the guard above drops the intermediate report.
        onScrollEndDrag={(event) => settle(indexAt(event))}
        onMomentumScrollEnd={(event) => settle(indexAt(event))}
      >
        {items.map((item, index) => (
          <View key={item} style={styles.item}>
            <Text
              variant="numeric"
              color={index === active ? 'text' : 'textTertiary'}
              style={index === active ? styles.itemActive : undefined}
            >
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface TimePickerModalProps {
  visible: boolean;
  title: string;
  /** The second line under the title. What the time will be used for. */
  message?: string;
  /** The current time as 24-hour `"HH:mm"`. Unparseable values open at 17:00. */
  value: string;
  confirmLabel?: string;
  onCancel: () => void;
  /** Receives 24-hour `"HH:mm"`, whichever clock the device presented. */
  onConfirm: (value: string) => void;
}

/**
 * The dialog. Same card, backdrop and button row as `PromptModal`, which is the
 * component this replaces at its one call site.
 */
export function TimePickerModal({
  visible,
  title,
  message,
  value,
  confirmLabel = 'Save',
  onCancel,
  onConfirm,
}: TimePickerModalProps) {
  const colors = useColors();

  // Re-read on every open rather than once per process: the 24-hour setting is
  // a system toggle the user can flip while the app is running, and the answer
  // decides how many rows the hour column has.
  const [twelveHour, setTwelveHour] = useState(prefersTwelveHourClock);
  const [draft, setDraft] = useState<ClockTime>(() => parseClockTime(value) ?? FALLBACK);

  /*
   * Re-seeds each time the dialog opens, so a cancelled edit does not persist
   * into the next one. Adjusted during render against what the draft was last
   * seeded from, the way `PromptModal` does it: an effect would do the same job
   * a commit later, painting the previous edit for a frame before correcting it.
   *
   * `generation` keys the wheels below. They are uncontrolled and read their
   * position once at mount, so re-seeding the draft is only half the job:
   * without a new key they would keep the scroll offset of the last edit.
   */
  const [seed, setSeed] = useState({ visible, value, generation: 0 });

  if (seed.visible !== visible || seed.value !== value) {
    setSeed((current) => ({
      visible,
      value,
      generation: current.generation + (visible ? 1 : 0),
    }));
    if (visible) {
      setDraft(parseClockTime(value) ?? FALLBACK);
      setTwelveHour(prefersTwelveHourClock());
    }
  }

  const pm = draft.hour >= 12;
  const hourIndex = twelveHour ? draft.hour % 12 : draft.hour;

  const setHourIndex = (index: number) =>
    setDraft((current) => ({
      ...current,
      hour: twelveHour ? index + (current.hour >= 12 ? 12 : 0) : index,
    }));

  const setMeridiem = (next: 'am' | 'pm') =>
    setDraft((current) => ({
      ...current,
      hour: next === 'pm' ? (current.hour % 12) + 12 : current.hour % 12,
    }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/*
        `accessible={false}` on both Pressables, deliberately: Pressable defaults
        to accessible, which would collapse the whole dialog into one element and
        take both wheels away from a screen reader. See `PromptModal`, which
        carries the same pair for the same reason.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
      >
        {/* Swallows taps inside the card so they don't dismiss the modal. */}
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text variant="subheading" accessibilityRole="header">
            {title}
          </Text>
          {message && (
            <Text variant="label" color="textSecondary">
              {message}
            </Text>
          )}

          <View key={seed.generation} style={styles.picker}>
            {/* Behind the columns, and never a touch target: the wheels have to
                receive every gesture that lands on them. */}
            <View
              pointerEvents="none"
              style={[styles.band, { backgroundColor: colors.surfaceMuted }]}
            />
            <View style={styles.columns}>
              <Wheel
                label="Hour"
                items={twelveHour ? HOURS_12 : HOURS_24}
                initialIndex={hourIndex}
                onChange={setHourIndex}
              />
              <Text variant="numeric" color="textTertiary" style={styles.colon}>
                :
              </Text>
              <Wheel
                label="Minute"
                items={MINUTES}
                initialIndex={draft.minute}
                onChange={(minute) => setDraft((current) => ({ ...current, minute }))}
              />
            </View>
          </View>

          {/*
            A segmented control rather than a two-row wheel. AM and PM are a
            two-way choice between abbreviations, which is the case
            `SettingSegmented` already documents as belonging in a track: a wheel
            holding two items is mostly empty space and snaps past both.
          */}
          {twelveHour && (
            <SegmentedControl
              label="Morning or afternoon"
              options={MERIDIEM_OPTIONS}
              value={pm ? 'pm' : 'am'}
              onChange={setMeridiem}
              style={styles.meridiem}
            />
          )}

          {/* Both buttons name what they act on: out of context a screen reader
              announces the visible word alone, and "Save" with no object is the
              same announcement in every dialog the app has. */}
          <View style={styles.actions}>
            <Button
              title="Cancel"
              accessibilityLabel={`Cancel, ${title}`}
              variant="ghost"
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              title={confirmLabel}
              accessibilityLabel={`${confirmLabel}, ${title}`}
              onPress={() => onConfirm(toClockTime(draft))}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  picker: { height: WHEEL_HEIGHT, justifyContent: 'center' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: WHEEL_PADDING,
    height: ITEM_HEIGHT,
    borderRadius: radius.md,
  },
  columns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  colon: { paddingHorizontal: spacing.xs },
  wheel: { width: WHEEL_WIDTH, height: WHEEL_HEIGHT },
  wheelContent: { paddingVertical: WHEEL_PADDING },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  // The row under the band is the value, so it is the one thing on the wheel
  // set at a size you can read from arm's length.
  itemActive: { fontSize: fontSize.xl },
  meridiem: { alignSelf: 'center', width: 160 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
