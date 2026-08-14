/**
 * Server-side Postgres schema.
 *
 * Mirrors the on-device SQLite schema, with two additions that only matter
 * server-side:
 *
 * 1. **`userId`** on every row — SQLite has one user per database, Postgres has
 *    all of them, and every query is scoped by it.
 *
 * 2. **`seq`**, drawn from a single global sequence. This is the pull cursor.
 *    Timestamps cannot do this job: two rows written in the same millisecond
 *    are indistinguishable, and a `WHERE updated_at > cursor` query would skip
 *    one of them forever. A sequence gives a strict total order over every
 *    write, across every table, so pagination can never lose a row.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** The single source of ordering for all replicated writes. */
export const syncSeq = pgSequence('sync_seq');

const seqDefault = sql`nextval('sync_seq')`;

/** Columns every replicated table carries. */
const syncColumns = {
  userId: text('user_id').notNull(),
  /** Epoch ms, authored by the client. Used only for last-write-wins. */
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  /** Tombstone. Non-null means deleted. */
  deletedAt: bigint('deleted_at', { mode: 'number' }),
  /** Server-assigned ordering. Bumped on every write. */
  seq: bigint('seq', { mode: 'number' }).notNull().default(seqDefault),
};

// ---------------------------------------------------------------------------
// better-auth tables
// ---------------------------------------------------------------------------
// Shapes are dictated by better-auth's Drizzle adapter — column names must
// match what it expects.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('account_user_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// ---------------------------------------------------------------------------
// Replicated application tables
// ---------------------------------------------------------------------------

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    equipment: text('equipment').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: jsonb('secondary_muscles').notNull().default([]),
    trackingType: text('tracking_type').notNull(),
    isCustom: boolean('is_custom').notNull().default(true),
    notes: text('notes'),
    imageUrl: text('image_url'),
    isArchived: boolean('is_archived').notNull().default(false),
    defaultRestSeconds: integer('default_rest_seconds'),
    ...syncColumns,
  },
  (table) => [index('exercises_sync_idx').on(table.userId, table.seq)],
);

export const routineFolders = pgTable(
  'routine_folders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: doublePrecision('position').notNull().default(0),
    ...syncColumns,
  },
  (table) => [index('routine_folders_sync_idx').on(table.userId, table.seq)],
);

export const routines = pgTable(
  'routines',
  {
    id: text('id').primaryKey(),
    folderId: text('folder_id'),
    name: text('name').notNull(),
    notes: text('notes'),
    position: doublePrecision('position').notNull().default(0),
    lastPerformedAt: bigint('last_performed_at', { mode: 'number' }),
    ...syncColumns,
  },
  (table) => [index('routines_sync_idx').on(table.userId, table.seq)],
);

export const routineExercises = pgTable(
  'routine_exercises',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id').notNull(),
    exerciseId: text('exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    notes: text('notes'),
    restSeconds: integer('rest_seconds'),
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [index('routine_exercises_sync_idx').on(table.userId, table.seq)],
);

export const routineSets = pgTable(
  'routine_sets',
  {
    id: text('id').primaryKey(),
    routineExerciseId: text('routine_exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    setType: text('set_type').notNull().default('normal'),
    targetReps: integer('target_reps'),
    targetWeightKg: doublePrecision('target_weight_kg'),
    targetDurationSeconds: integer('target_duration_seconds'),
    targetDistanceKm: doublePrecision('target_distance_km'),
    targetRpe: doublePrecision('target_rpe'),
    ...syncColumns,
  },
  (table) => [index('routine_sets_sync_idx').on(table.userId, table.seq)],
);

export const workouts = pgTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id'),
    name: text('name').notNull(),
    notes: text('notes'),
    startedAt: bigint('started_at', { mode: 'number' }).notNull(),
    finishedAt: bigint('finished_at', { mode: 'number' }),
    durationSeconds: integer('duration_seconds'),
    totalVolumeKg: doublePrecision('total_volume_kg').notNull().default(0),
    totalSets: integer('total_sets').notNull().default(0),
    totalReps: integer('total_reps').notNull().default(0),
    prCount: integer('pr_count').notNull().default(0),
    ...syncColumns,
  },
  (table) => [
    index('workouts_sync_idx').on(table.userId, table.seq),
    index('workouts_started_idx').on(table.userId, table.startedAt),
  ],
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id').notNull(),
    exerciseId: text('exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    notes: text('notes'),
    restSeconds: integer('rest_seconds'),
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [index('workout_exercises_sync_idx').on(table.userId, table.seq)],
);

export const workoutSets = pgTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    setType: text('set_type').notNull().default('normal'),
    weightKg: doublePrecision('weight_kg'),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    distanceKm: doublePrecision('distance_km'),
    rpe: doublePrecision('rpe'),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: bigint('completed_at', { mode: 'number' }),
    ...syncColumns,
  },
  (table) => [index('workout_sets_sync_idx').on(table.userId, table.seq)],
);

export const personalRecords = pgTable(
  'personal_records',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id').notNull(),
    kind: text('kind').notNull(),
    value: doublePrecision('value').notNull(),
    reps: integer('reps'),
    setId: text('set_id'),
    workoutId: text('workout_id'),
    achievedAt: bigint('achieved_at', { mode: 'number' }).notNull(),
    ...syncColumns,
  },
  (table) => [index('personal_records_sync_idx').on(table.userId, table.seq)],
);

export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    value: doublePrecision('value').notNull(),
    measuredAt: bigint('measured_at', { mode: 'number' }).notNull(),
    notes: text('notes'),
    ...syncColumns,
  },
  (table) => [index('body_measurements_sync_idx').on(table.userId, table.seq)],
);

/**
 * Idempotency ledger for pushes.
 *
 * A client that pushes, loses its connection before reading the response, and
 * retries would otherwise re-apply the same mutations. Recording
 * (device, clientSeq) lets the retry be acknowledged without redoing the work.
 */
export const syncReceipts = pgTable(
  'sync_receipts',
  {
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    clientSeq: bigint('client_seq', { mode: 'number' }).notNull(),
    appliedAt: timestamp('applied_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sync_receipts_pk').on(table.userId, table.deviceId, table.clientSeq),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

/** Wire-name → table, in parent-before-child order for safe application. */
export const SYNC_TABLES = {
  exercises,
  routine_folders: routineFolders,
  routines,
  routine_exercises: routineExercises,
  routine_sets: routineSets,
  workouts,
  workout_exercises: workoutExercises,
  workout_sets: workoutSets,
  personal_records: personalRecords,
  body_measurements: bodyMeasurements,
} as const;

export type SyncTableName = keyof typeof SYNC_TABLES;

export { seqDefault };
