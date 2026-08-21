/**
 * better-auth client for React Native.
 *
 * The Expo plugin keeps the session token in platform storage and handles the
 * deep-link round-trip that OAuth requires. Which storage that is depends on
 * where the app is running — see `token-storage`, which is also the reason this
 * module no longer touches `expo-secure-store` directly.
 */

import { expoClient } from '@better-auth/expo/client';
import Constants from 'expo-constants';
import { createAuthClient } from 'better-auth/react';
import { Platform } from 'react-native';

import { readToken, tokenStorage } from './token-storage';

/**
 * API base URL.
 *
 * Falls back to the LAN address Metro is served from, so a physical device can
 * reach a dev machine without anyone hardcoding an IP — `localhost` on a phone
 * resolves to the phone itself, which is the classic wasted afternoon here.
 * Set `EXPO_PUBLIC_API_URL` to point at a deployed instance.
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const configured = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured.length > 0) return configured;

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:3000`;
  }

  /*
   * In a browser, the page's own host is a better guess than `localhost`.
   *
   * The reasoning is the mirror image of the phone case above: there, the
   * device and the dev machine are different computers, so `localhost` is
   * wrong. Here the tab and the API may well be on the same machine — but if
   * the app is being reached over the LAN at `192.168.1.20:8081`, `localhost`
   * once again means "this computer" and points at the wrong one.
   */
  if (Platform.OS === 'web' && typeof location !== 'undefined' && location.hostname) {
    return `${location.protocol}//${location.hostname}:3000`;
  }

  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
  plugins: [
    expoClient({
      scheme: 'lift',
      storagePrefix: 'lift',
      storage: tokenStorage,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/**
 * The stored session token, for use as a Bearer header on sync requests.
 * Returns null when signed out — sync then stays local-only.
 */
export async function getSessionToken(): Promise<string | null> {
  return readToken('lift_session_token');
}

/** Authenticated fetch against the sync API. */
export async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  const cookie = authClient.getCookie();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The Expo plugin manages a cookie string; the server also accepts a
      // Bearer token, and sending the cookie keeps both paths working.
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SyncHttpError(response.status, text || response.statusText);
  }

  return (await response.json()) as T;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Sync failed (${status}): ${message}`);
    this.name = 'SyncHttpError';
  }

  /** 401 means the session expired — the user must sign in again. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
