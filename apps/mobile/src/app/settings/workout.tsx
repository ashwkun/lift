import { formatClockTime, formatDuration } from '@lift/shared';
import { useState } from 'react';

import { Card, Divider, Reveal, TimePickerModal, type ListPickerOption } from '@/components/ui';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingChoice, SettingToggle, SettingValue } from '@/features/settings/rows';
import { showAlert } from '@/store/dialog';
import { useSettings, type RestSoundOutput } from '@/store/settings';
import { spacing } from '@/theme';

/**
 * Rest presets, in seconds.
 *
 * Labelled with `formatDuration` ("1:30") rather than `formatDurationShort`,
 * which writes whole minutes and rendered 60 and 90 as the same "1m" and 120
 * and 150 as the same "2m". Four presets, two labels, and no way to tell from
 * the screen which of each pair was selected. Every other rest control in the
 * app already uses the colon form; this one now agrees with them.
 */
const REST_PRESETS = [60, 90, 120, 150, 180, 240];

/**
 * Where the bell comes out of the phone.
 *
 * Written as three promises about what you will hear rather than three
 * technical routes, because that is the only part of the difference anyone can
 * check. The failure this exists to fix has no name a settings screen can use:
 * a bell on the music volume goes wherever the music goes, so a pair of earbuds
 * on the bench next to you is a bell you will never hear, and every one of the
 * "my rest timer stopped working" moments this app has had was that.
 */
const SOUND_OUTPUTS: readonly ListPickerOption<RestSoundOutput>[] = [
  {
    value: 'media',
    label: 'Media',
    description: 'Plays in the app, at your music volume. Goes to your earbuds, and only there.',
  },
  {
    value: 'notification',
    label: 'Notification',
    description: 'Rung by the phone at its notification volume, through its own speaker.',
  },
  {
    value: 'alarm',
    label: 'Alarm',
    // Not a claim about volume alone: silent mode mutes the ring and
    // notification streams and leaves the alarm one running, which is the
    // difference between this and the row above it on a phone in a pocket.
    description: 'The same, at alarm volume. The loudest, and the one silent mode leaves alone.',
  },
];

/**
 * Everything that changes what a session does, in the order it happens: the
 * rest timer's master switch, its settings, when the reminder to come in fires,
 * and what the phone itself does once you are here.
 */
export default function WorkoutSettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

  const [editingTime, setEditingTime] = useState(false);

  const restOff = !settings.restTimerEnabled;
  /** Both routes that hand the bell to the OS rather than playing it in-app. */
  const soundGoesThroughPhone = settings.restTimerSoundOutput !== 'media';
  /** The stored "HH:mm" as the device writes a clock: "5:00 pm" or "17:00". */
  const reminderTime = formatClockTime(settings.gymReminderTime);

  /**
   * Turning the switch on is three things that can each fail, so the preference
   * is only recorded once something is genuinely pending with the OS.
   *
   * Every failure now says which one it was. Before this the switch simply
   * refused to move: no permission dialog, no explanation, and no way to tell a
   * denied permission from a build that has no notification module at all.
   */
  const toggleReminder = async (enabled: boolean) => {
    const reminder = await import('@/features/notifications/reminder');

    if (!enabled) {
      update('gymReminderEnabled', false);
      await reminder.cancelGymReminder();
      return;
    }

    const permission = await reminder.prepareReminderNotifications();

    if (permission === 'unsupported') {
      await showAlert(
        'Reminders are not available here',
        'Scheduling one needs a development or store build. Expo Go on Android and the browser build both run without a notification module.',
      );
      return;
    }

    if (permission === 'denied') {
      await showAlert(
        'Notifications are off',
        'Lift needs permission to post notifications before it can remind you. Turn them on for Lift in your phone settings, then try again.',
      );
      return;
    }

    if (!(await reminder.scheduleGymReminder(settings.gymReminderTime))) {
      await showAlert(
        'Reminder not set',
        'The daily reminder could not be scheduled. Check that notifications are still enabled for Lift in your phone settings.',
      );
      return;
    }

    update('gymReminderEnabled', true);
  };

  return (
    <SettingsPage title="Workout">
      <Reveal>
        {/*
         * The master switch, alone in its own card.
         *
         * Everything in the card below it is dead while this is off, and a
         * disabled row sitting directly under the switch that disabled it is
         * ambiguous about which way the dependency runs. Two cards state it:
         * this is the thing, those are its settings.
         */}
        <Card padded={false} style={settingsStyles.first}>
          <SettingToggle
            icon="timer-outline"
            label="Rest timer"
            description="Counts down between sets."
            value={settings.restTimerEnabled}
            onChange={(value) => update('restTimerEnabled', value)}
          />
        </Card>

        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingChoice
            icon="hourglass-outline"
            label="Default rest"
            options={REST_PRESETS.map((seconds) => ({
              value: String(seconds),
              label: formatDuration(seconds),
            }))}
            value={String(settings.defaultRestSeconds)}
            onChange={(value) => update('defaultRestSeconds', Number(value))}
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="play-circle-outline"
            label="Start automatically"
            description="Begins the moment you check off a set."
            value={settings.restTimerAutoStart}
            onChange={(value) => update('restTimerAutoStart', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="notifications-outline"
            label="Notify when finished"
            description="Rings even with the app closed."
            value={settings.restTimerNotifications}
            onChange={(value) => update('restTimerNotifications', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="volume-medium-outline"
            label="Alert sound"
            description="Beeps through the last ten seconds, then the bell."
            value={settings.soundEnabled}
            onChange={(value) => update('soundEnabled', value)}
            disabled={restOff}
            disabledReason="The rest timer is off."
          />
          <Divider inset={spacing.lg} />
          <SettingChoice
            icon="volume-high-outline"
            label="Sound output"
            // Two descriptions, because the row has a dependency it cannot
            // enforce: the phone can only ring the bell if it was given one to
            // ring, and that is the switch two rows up. Saying so on the row
            // beats a footnote nobody reads and beats silently doing something
            // other than what the row says.
            description={
              soundGoesThroughPhone && !settings.restTimerNotifications
                ? 'Plays in the app until Notify when finished is on.'
                : "Which of the phone's volumes the bell rings at."
            }
            options={SOUND_OUTPUTS}
            value={settings.restTimerSoundOutput}
            onChange={(value) => update('restTimerSoundOutput', value)}
            disabled={restOff || !settings.soundEnabled}
            disabledReason={restOff ? 'The rest timer is off.' : 'The alert sound is off.'}
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="pulse-outline"
            label="Countdown buzz"
            description="A tap on each of the last three seconds."
            value={settings.restTimerCountdownCues}
            onChange={(value) => update('restTimerCountdownCues', value)}
            disabled={restOff || !settings.hapticsEnabled}
            disabledReason={restOff ? 'The rest timer is off.' : 'Haptic feedback is off.'}
          />
        </Card>
        <Footnote>
          The default is only a fallback. Tap the timer next to an exercise while logging to set its
          own rest, and every future workout containing that exercise will use it.
        </Footnote>

        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingToggle
            icon="calendar-outline"
            label="Gym reminder"
            // Names the hour rather than describing the feature in the abstract.
            // The row below already holds the time, but the switch is what the
            // eye lands on, and "am I set for 5 or 6" is the question people
            // open this page to answer.
            description={`A daily nudge at ${reminderTime}.`}
            value={settings.gymReminderEnabled}
            onChange={(value) => void toggleReminder(value)}
          />
          <Divider inset={spacing.lg} />
          <SettingValue
            icon="time-outline"
            label="Reminder time"
            value={reminderTime}
            hint="Opens the time picker"
            onPress={() => setEditingTime(true)}
          />
        </Card>

        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingToggle
            icon="phone-portrait-outline"
            label="Haptic feedback"
            // Deliberately general. `features/feedback/haptics.ts` fires on
            // sets, timers, deletions, reorders and refusals, across the whole
            // app rather than only inside a workout: a description naming any
            // one of those would be describing a fraction of the switch.
            description="Short taps confirming what you just did."
            value={settings.hapticsEnabled}
            onChange={(value) => update('hapticsEnabled', value)}
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="eye-outline"
            label="Keep screen on"
            description="Prevents the phone locking between sets."
            value={settings.keepAwakeDuringWorkout}
            onChange={(value) => update('keepAwakeDuringWorkout', value)}
          />
        </Card>
      </Reveal>

      <TimePickerModal
        visible={editingTime}
        title="Reminder time"
        message="Repeats every day."
        value={settings.gymReminderTime}
        onCancel={() => setEditingTime(false)}
        onConfirm={(time) => {
          setEditingTime(false);
          update('gymReminderTime', time);

          // The only way to move a scheduled notification is to cancel it and
          // post a new one, which is what `scheduleGymReminder` does. Skipped
          // while the reminder is off: the switch schedules from the stored
          // time when it is turned on.
          if (settings.gymReminderEnabled) {
            void import('@/features/notifications/reminder').then(({ scheduleGymReminder }) =>
              scheduleGymReminder(time),
            );
          }
        }}
      />
    </SettingsPage>
  );
}
