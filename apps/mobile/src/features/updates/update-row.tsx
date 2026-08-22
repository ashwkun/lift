/**
 * The settings row for over-the-air updates.
 *
 * Deliberately the only place in the app that mentions them. A downloaded
 * update is applied by the next cold start whether or not anybody visits this
 * screen, so interrupting a workout to announce one would be spending the
 * user's attention on something that resolves itself. What this row adds is a
 * way to ask early, a way to skip the wait, and somewhere for the answer to
 * appear when the phone is offline or the check is failing.
 */

import { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { SettingAction } from '@/features/settings/rows';
import { showConfirm } from '@/store/dialog';
import { spacing, useColors } from '@/theme';
import { useAppUpdate, type UpdateStatus } from './use-app-update';

/**
 * What each state says, and whether tapping it does anything.
 *
 * A table rather than a chain of conditionals in the component, because the
 * thing worth reviewing here is the copy: eight states, each of which has to
 * read as a status on its own, with no other row on the screen to compare
 * against. `action` is what a tap means, and `null` marks the states that are
 * already in motion and have nothing to add.
 */
const STATES: Record<
  Exclude<UpdateStatus, 'unsupported'>,
  { value: string; description: string; action: 'check' | 'install' | null }
> = {
  idle: {
    value: 'Check',
    description: 'Looks for a new version of the app.',
    action: 'check',
  },
  checking: {
    value: 'Checking',
    description: 'Asking for a newer version.',
    action: null,
  },
  available: {
    value: 'Download',
    description: 'A new version is waiting.',
    action: 'check',
  },
  downloading: {
    value: 'Downloading',
    description: 'Downloading the new version.',
    action: null,
  },
  ready: {
    value: 'Restart',
    description: 'Downloaded. It applies next time Lift starts, or now.',
    action: 'install',
  },
  restarting: {
    value: 'Restarting',
    description: 'Applying the new version.',
    action: null,
  },
  upToDate: {
    value: 'Check',
    // Reads as the result of the check that just ran, which is the only reason
    // this differs from `idle`: same action, different thing just learnt.
    description: 'This is the newest version.',
    action: 'check',
  },
  failed: {
    // Replaced by the library's own message whenever there is one, which there
    // almost always is. This is the line for a failure that arrived empty.
    value: 'Retry',
    description: 'The last check did not finish.',
    action: 'check',
  },
};

export function UpdateRow() {
  const colors = useColors();
  const update = useAppUpdate();
  const [confirming, setConfirming] = useState(false);

  // A development build and the web export have no update mechanism at all, and
  // a row reporting that forever is worse than no row: it is permanent, it is
  // never actionable, and it describes the build rather than the app.
  if (update.status === 'unsupported') return null;

  const state = STATES[update.status];
  const busy = state.action === null;

  // The percentage, and only when there is a real figure behind it.
  //
  // `downloadProgress` stays at 0 until the server sends a Content-Length, so
  // this is `null` for the whole of a download with no length to divide by, and
  // that case falls through to the spinner rather than sitting on "0%", which
  // reads as stuck rather than as starting. A number, when there is one, is
  // worth more than the spinner it replaces: this is the one state here that
  // takes long enough for the difference to matter.
  const percent =
    update.status === 'downloading' && update.progress ? Math.round(update.progress * 100) : null;

  const description =
    update.status === 'failed' && update.error
      ? // The library's own message, which is usually a network error worth
        // reading: it distinguishes "no signal" from "this build's runtime has
        // no updates published against it", and those have different answers.
        update.error
      : state.description;

  const press = () => {
    if (update.status === 'ready') {
      void (async () => {
        setConfirming(true);
        // Asked rather than done, because a reload is a cold start: the screen
        // goes away and comes back. Everything logged is already in the
        // database and the rest period is restored on launch, so nothing is
        // lost, but the moment is the user's to pick. Mid-set is not it.
        const confirmed = await showConfirm({
          title: 'Restart now?',
          message:
            'Lift closes and reopens on the new version. Your workouts, and any rest timer running, are kept.',
          confirmLabel: 'Restart',
          tone: 'confirm',
        });
        setConfirming(false);
        if (confirmed) update.install();
      })();
      return;
    }

    update.check();
  };

  return (
    <SettingAction
      icon="cloud-download-outline"
      label="App updates"
      description={description}
      tone="neutral"
      disabled={busy || confirming}
      onPress={press}
      trailing={
        busy && percent === null ? (
          <ActivityIndicator size="small" color={colors.textTertiary} style={styles.spinner} />
        ) : (
          <Text variant="label" color="textSecondary" numberOfLines={1} style={styles.trailing}>
            {percent === null ? state.value : `${percent}%`}
          </Text>
        )
      }
    />
  );
}

/**
 * Which bundle is running, as a line under the version in the screen's footer.
 *
 * The one piece of this feature that matters after it has worked: with updates
 * on, the version string stops identifying what is actually on the phone, and
 * two people on "Lift 0.5.0" can be running different JavaScript. This prints
 * the short form of the update id beside it so a bug report names a bundle.
 */
export function UpdateFooter() {
  const update = useAppUpdate();

  if (update.status === 'unsupported') return null;

  return (
    <Text variant="caption" color="textTertiary" align="center">
      {update.running === 'Built in' ? 'Built-in bundle' : `Bundle ${update.running}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Matches `SettingValue`'s trailing readout, so the two sit on the same
  // right-hand edge when they share a card.
  trailing: { flexShrink: 1, textAlign: 'right' },
  // The spinner is narrower than the words it replaces, and without this the
  // row's contents shift left every time a check starts.
  spinner: { width: spacing.xxl },
});
