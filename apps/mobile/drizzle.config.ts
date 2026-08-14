import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // Emits a migrations bundle that expo-sqlite can apply on device at startup.
  driver: 'expo',
} satisfies Config;
