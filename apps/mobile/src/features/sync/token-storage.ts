/**
 * Where the session token lives, per platform.
 *
 * On a phone this is the OS keychain, via `expo-secure-store` — a session token
 * is a credential, so it does not belong in AsyncStorage. In a browser there is
 * no keychain, and `expo-secure-store`'s web build is not a degraded version of
 * one: it is `export default {}`. Every function in the module's public surface
 * reaches straight through to that empty object, so `SecureStore.getItem` on web
 * is not a no-op returning null, it is a `TypeError` thrown out of the auth
 * client's constructor path. That takes the whole app down at import time, not
 * just sync.
 *
 * So web gets `localStorage`, which is the same trust boundary a browser session
 * cookie has and the ceiling for what a static, server-less bundle can offer.
 * Worth stating plainly rather than leaving implied: a token in `localStorage`
 * is readable by any script running on the origin, where the keychain copy is
 * not. This app serves its own bundle and loads no third-party scripts, which is
 * the condition that makes it an acceptable trade — and it is the same one every
 * signed-in web app makes.
 *
 * The shape is the synchronous `getItem`/`setItem` pair `expoClient` asks for.
 * Both platforms satisfy it, so nothing downstream branches.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

/**
 * True when a browser has actually granted storage.
 *
 * `localStorage` is absent during server-side rendering — this app exports with
 * `output: 'static'`, so its route tree is rendered in Node once at build time —
 * and it *throws on access* rather than returning undefined in a tab where the
 * user has blocked site data. Reading it through a try/catch once, here, is what
 * keeps every call site below a plain property access.
 */
function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The storage handed to `expoClient`.
 *
 * Failures are swallowed to null rather than raised. The caller is better-auth's
 * cookie layer, which treats a missing token as "signed out" — the correct
 * reading when storage is unavailable — whereas a throw from inside it surfaces
 * as an unhandled rejection on a screen that has nothing to do with sync. The
 * app is local-first: losing the session costs backup, not the training log.
 */
export const tokenStorage = {
  getItem(key: string): string | null {
    try {
      return isWeb ? (webStorage()?.getItem(key) ?? null) : SecureStore.getItem(key);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      if (isWeb) webStorage()?.setItem(key, value);
      else SecureStore.setItem(key, value);
    } catch {
      // Private-mode quota, blocked site data, a locked keychain. All of them
      // mean the same thing to the user: this session will not survive a
      // restart. None of them are worth interrupting a workout over.
    }
  },
};

/**
 * Reads a token asynchronously, for the sync engine's Bearer header.
 *
 * Separate from `tokenStorage.getItem` because the native path is genuinely
 * async — `SecureStore.getItemAsync` is the API that does not block the JS
 * thread on a keychain round-trip, and sync runs on launch, where that matters.
 */
export async function readToken(key: string): Promise<string | null> {
  try {
    if (isWeb) return webStorage()?.getItem(key) ?? null;
    return (await SecureStore.getItemAsync(key)) ?? null;
  } catch {
    return null;
  }
}
