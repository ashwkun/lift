/**
 * The in-app half of the rest-timer alert.
 *
 * The scheduled notification carries the same bell, but the system only
 * presents it when the app is in the background — and not at all if the user
 * declined the permission. This plays it directly so the cue is identical
 * either way, and so a denied notification prompt costs the user a banner
 * rather than the entire feature.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Relative rather than through the `@/assets` alias: this is the app's only
// bundled sound and a mis-resolved asset path fails at runtime, not at build.
const BELL = require('../../../assets/sounds/rest_complete.wav');

let player: AudioPlayer | null = null;
let audioModeSet = false;

function ensurePlayer(): AudioPlayer {
  if (!audioModeSet) {
    audioModeSet = true;

    void setAudioModeAsync({
      // A gym is loud and the ringer switch is not a statement about the rest
      // timer — someone who silenced their phone still wants to know rest is up.
      playsInSilentMode: true,
      // Layers over whatever the user is listening to. `duckOthers` would dip
      // their music for a 2.8-second bell, and `doNotMix` would stop it dead.
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // An audio session the OS refuses to configure still plays through the
      // defaults; there is nothing useful to tell the user here.
    });
  }

  // Held for the life of the process. Creating a player per ring would put a
  // decode on the critical path of the one sound that has to land on time.
  player ??= createAudioPlayer(BELL);
  return player;
}

/** Rings the bell from the start, interrupting a ring already in progress. */
export async function playRestBell(): Promise<void> {
  try {
    const instance = ensurePlayer();
    await instance.seekTo(0);
    instance.play();
  } catch {
    // A device mid-call, or an audio route that vanished with a Bluetooth
    // disconnect. The haptic and the notification still land.
  }
}

/**
 * Frees the native player.
 *
 * Worth calling when the last workout screen unmounts — the decoded buffer is
 * a few hundred kilobytes that nothing outside a session needs.
 */
export function releaseRestBell(): void {
  player?.remove();
  player = null;
}
