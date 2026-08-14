/**
 * better-auth configuration.
 *
 * Chosen over hand-rolling because email verification, password reset, refresh
 * token rotation and OAuth are each an opportunity to introduce a security bug,
 * and none of them are the interesting part of a workout tracker.
 */

import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';

import { db } from '../db/client.js';
import { account, session, user, verification } from '../db/schema.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

/**
 * Origins permitted to complete an auth flow.
 *
 * The app's deep-link scheme (`lift://`) must be present or OAuth redirects
 * back into the app are rejected.
 */
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? 'lift://')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  socialProviders.apple = {
    clientId: process.env.APPLE_CLIENT_ID,
    clientSecret: process.env.APPLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  secret: required('BETTER_AUTH_SECRET'),
  baseURL: required('BETTER_AUTH_URL'),
  trustedOrigins,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    // Verification email delivery isn't wired up yet; requiring it here would
    // lock every new account out. Turn this on once an email provider exists.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  socialProviders,

  session: {
    // Long-lived because a training app is opened in a gym, often on bad
    // signal, and being logged out mid-workout is unacceptable.
    expiresIn: 60 * 60 * 24 * 60, // 60 days
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
  },

  plugins: [
    // Handles the deep-link callback and secure token storage on the RN side.
    expo(),
    /**
     * Accepts `Authorization: Bearer <token>` in addition to cookies.
     *
     * Required for the mobile client: React Native has no cookie jar of its
     * own, and threading Set-Cookie through fetch is far more fragile than
     * storing one token in SecureStore and sending it explicitly.
     */
    bearer(),
  ],
});

export type Auth = typeof auth;
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
