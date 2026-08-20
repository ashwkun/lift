/**
 * Applies pending migrations at boot.
 *
 * drizzle-kit is a dev dependency and is pruned from the runtime image, so a
 * deployed container cannot shell out to `pnpm db:migrate`. The migrator that
 * ships with drizzle-orm reads the same `drizzle/` folder and the same journal,
 * so what runs in production is exactly the SQL generated in development.
 *
 * Doing this in-process rather than as a separate deploy step means a fresh
 * database is usable the moment the container reports healthy, and a rollout
 * carrying a migration can never begin serving before that migration lands.
 */

import { Logger } from '@nestjs/common';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';

import { db } from './client.js';

/**
 * Two levels up from the compiled `dist/db/` — the migrations sit beside `dist`
 * rather than inside it, because they are data the build copies rather than
 * something it compiles. The relative position holds both in the image and in
 * a local `apps/api/dist` build.
 */
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

export async function runMigrations(): Promise<void> {
  const logger = new Logger('Migrations');

  logger.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  logger.log('Database schema is up to date');
}
