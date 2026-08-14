/**
 * better-auth client for React Native.
 *
 * The Expo plugin stores the session token in SecureStore (not AsyncStorage —
 * a session token is a credential) and handles the deep-link round-trip that
 * OAuth requires.
 */

import { expoClient } from '@better-auth/expo/client';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createAuthClient } from 'better-auth/react';

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

  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
  plugins: [
    expoClient({
      scheme: 'lift',
      storagePrefix: 'lift',
      storage: SecureStore,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/**
 * The stored session token, for use as a Bearer header on sync requests.
 * Returns null when signed out — sync then stays local-only.
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync('lift_session_token')) ?? null;
  } catch {
    return null;
  }
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
