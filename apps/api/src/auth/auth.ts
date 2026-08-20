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

/**
 * Reverse-proxy hops to skip when resolving the caller's IP.
 *
 * better-auth turns rate limiting on by itself in production and keys it on
 * `x-forwarded-for`. Left unconfigured it only trusts that header when it holds
 * exactly one address — behind Traefik, anyone who sends an `x-forwarded-for`
 * of their own makes it two, at which point better-auth can no longer identify
 * the caller and drops every request into a single shared bucket. Sign-in
 * allows three attempts per ten seconds, so one client could lock out the rest.
 *
 * Naming the proxies instead walks the chain from the right, skips the hops we
 * put there, and takes the first address we did not add — the real caller, with
 * any spoofed prefix rendered irrelevant. The default covers Docker's private
 * ranges, which behind Dokploy is exactly the proxy and nothing else. Set
 * TRUSTED_PROXIES to pin the subnet, or to extend the chain if a CDN is ever
 * put in front of Traefik.
 */
const trustedProxies = (
  process.env.TRUSTED_PROXIES ?? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
)
  .split(',')
  .map((range) => range.trim())
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

  advanced: {
    ipAddress: { trustedProxies },
  },

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
