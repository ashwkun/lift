import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

/**
 * Connection pool.
 *
 * `max: 10` suits a single VPS container — Postgres allocates memory per
 * backend, so a large pool from one app instance mostly buys contention.
 * Raise it only alongside `max_connections`.
 */
export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Numeric columns come back as strings by default to preserve precision;
  // our bigints are sequence values and epoch-ms, both far below 2^53.
  transform: { undefined: null },
});

export const db = drizzle(sql, { schema });

export type Database = typeof db;
export { schema };
