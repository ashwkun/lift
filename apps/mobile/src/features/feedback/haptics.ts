/**
 * Haptic vocabulary for the app.
 *
 * Every cue routes through here rather than calling `expo-haptics` directly,
 * for two reasons. The `hapticsEnabled` preference is checked once, in one
 * place, so a new call site cannot forget it and buzz a user who turned it
 * off. And naming the cues by *meaning*: `logged`, `finished`, `destructive`.
 * Rather than by intensity keeps the scale coherent: the alternative is a
 * dozen call sites each independently deciding whether deleting a set is
 * `Medium` or `Heavy`, which is how an app ends up buzzing identically for
 * everything and teaching the user to ignore it.
 *
 * The store is read via `getState()` rather than a hook so non-React code
 * (repositories, the timer store) can fire a cue too.
 */

import * as Haptics from 'expo-haptics';

import { useSettings } from '@/store/settings';

/**
 * Fire-and-forget.
 *
 * A haptic is decoration on an action that already happened, so a device that
 * refuses one (no motor, an OS that throttles them, a permission quirk) must
 * not surface an unhandled rejection for it.
 */
function fire(run: () => Promise<void>): void {
  if (!useSettings.getState().hapticsEnabled) return;
  void run().catch(() => {});
}

export const haptics = {
  /**
   * A set was checked off. The most frequent cue in the app by a wide margin,
   * which is why it stays a notification-success rather than a heavy impact.
   * Fifty heavy buzzes a session is a numb thumb.
   */
  logged: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** An exercise or a whole workout closed out. Deliberately heavier than `logged`. */
  finished: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),

  /** Something appeared or was added: a set, an exercise, a sheet opening. */
  added: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** A value moved between discrete states. Set type cycling, a segmented control. */
  selection: () => fire(() => Haptics.selectionAsync()),

  /** Something was removed or thrown away. */
  destructive: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** An action was refused: nothing logged yet, validation failed. */
  rejected: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** Rest hit zero. Shares `logged`'s weight: both mean "carry on". */
  restComplete: () =>
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** One of the last few seconds of a rest countdown ticking past. */
  countdownTick: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
