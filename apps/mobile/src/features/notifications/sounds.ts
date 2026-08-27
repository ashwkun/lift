/**
 * The in-app half of the rest-timer alert: the countdown beep, and the bell.
 *
 * The scheduled notification carries the same bell, but the system only
 * presents it when the app is in the background, and not at all if the user
 * declined the permission. This plays it directly so the cue is identical
 * either way, and so a denied notification prompt costs the user a banner
 * rather than the entire feature.
 *
 * The beep has no notification counterpart and cannot have one. It fires seven
 * times in the last ten seconds, and seven scheduled notifications per set is
 * not a countdown, it is a notification channel someone turns off. It is played
 * from here or not at all, on screen or in a pocket: the workout's foreground
 * service keeps this clock running either way, and `restTimerBackgroundBeeps`
 * is where the user says which of the two they wanted. The bell at zero is the
 * alert regardless, and that one *is* scheduled.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Relative rather than through the `@/assets` alias: a mis-resolved asset path
// fails at runtime, not at build.
const SOURCES = {
  bell: require('../../../assets/sounds/rest_complete.wav'),
  beep: require('../../../assets/sounds/countdown_beep.wav'),
} as const;

type Cue = keyof typeof SOURCES;

const players = new Map<Cue, AudioPlayer>();
let audioModeSet = false;

function ensureAudioMode(): void {
  if (audioModeSet) return;
  audioModeSet = true;

  void setAudioModeAsync({
    // A gym is loud and the ringer switch is not a statement about the rest
    // timer: someone who silenced their phone still wants to know rest is up.
    playsInSilentMode: true,
    // Layers over whatever the user is listening to. `duckOthers` would dip
    // their music for every beep in the countdown, which over the last ten
    // seconds is worse than the beeps themselves, and `doNotMix` would stop it
    // dead.
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => {
    // An audio session the OS refuses to configure still plays through the
    // defaults; there is nothing useful to tell the user here.
  });
}

function ensurePlayer(cue: Cue): AudioPlayer {
  ensureAudioMode();

  let player = players.get(cue);
  if (!player) {
    player = createAudioPlayer(SOURCES[cue]);
    players.set(cue, player);
  }

  return player;
}

async function play(cue: Cue): Promise<void> {
  try {
    const player = ensurePlayer(cue);
    await player.seekTo(0);
    player.play();
  } catch {
    // A device mid-call, or an audio route that vanished with a Bluetooth
    // disconnect. The haptics and the notification still land.
  }
}

/**
 * Decodes both cues ahead of time.
 *
 * Called when a rest period starts, which is the one moment with time to spare:
 * the first beep is ten seconds from zero and the bell is behind it. Left lazy,
 * the decode would land on the first beep. The cue that has to be *on* the
 * second to read as a countdown at all, and a player created inside that tick
 * is a cue that arrives late on exactly the beat that matters.
 *
 * Idempotent, and cheap after the first call.
 */
export function primeRestSounds(): void {
  ensurePlayer('bell');
  ensurePlayer('beep');
}

/** Rings the bell from the start, interrupting a ring already in progress. */
export function playRestBell(): Promise<void> {
  return play('bell');
}

/**
 * One tick of the countdown.
 *
 * Short enough (~0.2s) that consecutive beeps a second apart never overlap, so
 * a single player is restarted rather than a pool of them being juggled.
 */
export function playCountdownBeep(): Promise<void> {
  return play('beep');
}

/**
 * Frees the native players.
 *
 * Worth calling when the last workout screen unmounts. The decoded buffers are
 * a few hundred kilobytes that nothing outside a session needs.
 */
export function releaseRestSounds(): void {
  for (const player of players.values()) player.remove();
  players.clear();
}
