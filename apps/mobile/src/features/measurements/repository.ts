/**
 * Body measurement tracking.
 *
 * Values are stored canonically: kilograms for bodyweight, percent for body
 * fat, centimetres for every circumference, so switching display units never
 * rewrites history. What each kind *is*, and the arithmetic over a series of
 * them, lives in `@lift/shared`'s `measurements` module; this file is only the
 * table.
 */

import { uuidv7, type MeasurementKind, type MeasurementPoint } from '@lift/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import { bodyMeasurements, type BodyMeasurement } from '@/db/schema';
import { useSettings } from '@/store/settings';

import { bumpMeasurementRevision } from './revision';

export async function recordMeasurement(input: {
  kind: MeasurementKind;
  value: number;
  measuredAt?: Date;
  notes?: string | null;
}): Promise<BodyMeasurement> {
  const now = Date.now();
  const measuredAt = input.measuredAt ?? new Date(now);

  const row = {
    id: uuidv7(),
    kind: input.kind,
    value: input.value,
    measuredAt,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(bodyMeasurements).values(row);
  await trackUpsert('body_measurements', { ...row, measuredAt: measuredAt.getTime() });

  if (input.kind === 'bodyweight') await mirrorBodyweightToSettings();
  bumpMeasurementRevision();

  return row;
}

/** Records a bodyweight and mirrors it into settings. */
export async function recordBodyweight(kg: number): Promise<BodyMeasurement> {
  return recordMeasurement({ kind: 'bodyweight', value: kg });
}

/**
 * Corrects an entry already filed.
 *
 * A tape read wrong, or a weigh-in filed on the wrong day, used to be
 * uncorrectable. The log was append-only from the UI's point of view, so the
 * only way out was to delete the row and lose its date. The oplog entry is
 * coalesced because editing the same reading twice before a sync is one
 * correction, not two.
 */
export async function updateMeasurement(
  id: string,
  patch: { value?: number; measuredAt?: Date; notes?: string | null },
): Promise<void> {
  const updatedAt = Date.now();

  const [updated] = await db
    .update(bodyMeasurements)
    .set({ ...patch, updatedAt, syncState: 'pending' })
    .where(eq(bodyMeasurements.id, id))
    .returning();

  if (!updated) return;

  await trackUpsertCoalesced('body_measurements', {
    ...updated,
    measuredAt: updated.measuredAt.getTime(),
  });

  // The edit may have moved which reading is newest, or changed the value of
  // the one that already was.
  if (updated.kind === 'bodyweight') await mirrorBodyweightToSettings();
  bumpMeasurementRevision();
}

/**
 * Copies the newest bodyweight into the settings store.
 *
 * Volume for push-ups, pull-ups and dips is computed from
 * `settings.bodyweightKg`, and until this existed nothing ever wrote it: a
 * calisthenics session logged 0 kg and Home read 0 with no explanation. Mirrored
 * here rather than at the call site so logging a bodyweight *anywhere* is
 * enough, and re-read from the table rather than taken from the row just
 * inserted so a backdated entry cannot overwrite a newer one.
 */
async function mirrorBodyweightToSettings(): Promise<void> {
  const [newest] = await db
    .select({ value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
    .orderBy(desc(bodyMeasurements.measuredAt))
    .limit(1);

  useSettings.getState().update('bodyweightKg', newest?.value ?? null);
}

/** Full history for one measurement, oldest first (chart-ready). */
export async function getMeasurementHistory(kind: MeasurementKind): Promise<BodyMeasurement[]> {
  return db
    .select()
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.kind, kind), isNull(bodyMeasurements.deletedAt)))
    .orderBy(bodyMeasurements.measuredAt);
}

/** Every kind's history, oldest first, keyed by kind. */
export type MeasurementLog = Map<MeasurementKind, BodyMeasurement[]>;

/**
 * The whole log in one query.
 *
 * The overview screen shows a figure, a delta and a sparkline for fifteen
 * kinds. Fetching that per kind is fifteen round trips to open one screen, and
 * this replaces a query that returned only each kind's newest row, which is
 * why the trend used to be hidden behind a tap. The table is small (one row per
 * reading per kind, so hundreds after years of use), so reading it whole and
 * grouping in memory is both simpler and faster than any arrangement of
 * per-kind queries.
 */
export async function getMeasurementLog(): Promise<MeasurementLog> {
  const rows = await db
    .select()
    .from(bodyMeasurements)
    .where(isNull(bodyMeasurements.deletedAt))
    .orderBy(bodyMeasurements.measuredAt);

  const log: MeasurementLog = new Map();
  for (const row of rows) {
    const existing = log.get(row.kind);
    if (existing) existing.push(row);
    else log.set(row.kind, [row]);
  }
  return log;
}

/**
 * Database rows in the shape the shared series maths takes.
 *
 * That module is deliberately ignorant of Drizzle and of `Date`, so the
 * conversion happens once here rather than inline at every call site that wants
 * a trend.
 */
export function toMeasurementPoints(rows: readonly BodyMeasurement[]): MeasurementPoint[] {
  return rows.map((row) => ({ at: row.measuredAt.getTime(), value: row.value }));
}

export async function deleteMeasurement(id: string): Promise<void> {
  const deletedAt = Date.now();

  const [removed] = await db
    .update(bodyMeasurements)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(bodyMeasurements.id, id))
    .returning({ kind: bodyMeasurements.kind });

  await trackDelete('body_measurements', id, deletedAt);

  // Re-derive rather than leave the settings copy pointing at a row that is now
  // a tombstone. Only for bodyweight: any other kind would clear a value the
  // user may have typed in Settings without ever logging a measurement.
  if (removed?.kind === 'bodyweight') await mirrorBodyweightToSettings();
  bumpMeasurementRevision();
}
