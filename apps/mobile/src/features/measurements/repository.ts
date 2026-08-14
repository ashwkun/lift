/**
 * Body measurement tracking.
 *
 * Values are stored canonically — kilograms for bodyweight, percent for body
 * fat, centimetres for every circumference — so switching display units never
 * rewrites history.
 */

import { uuidv7, type MeasurementKind } from '@lift/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { trackDelete, trackUpsert } from '@/db/mutations';
import { bodyMeasurements, type BodyMeasurement } from '@/db/schema';

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

  return row;
}

/** Full history for one measurement, oldest first (chart-ready). */
export async function getMeasurementHistory(kind: MeasurementKind): Promise<BodyMeasurement[]> {
  return db
    .select()
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.kind, kind), isNull(bodyMeasurements.deletedAt)))
    .orderBy(bodyMeasurements.measuredAt);
}

/** Most recent value for each kind that has ever been recorded. */
export async function getLatestMeasurements(): Promise<Map<MeasurementKind, BodyMeasurement>> {
  const rows = await db
    .select()
    .from(bodyMeasurements)
    .where(isNull(bodyMeasurements.deletedAt))
    .orderBy(desc(bodyMeasurements.measuredAt));

  const latest = new Map<MeasurementKind, BodyMeasurement>();
  // Rows arrive newest-first, so the first sighting of a kind is its latest.
  for (const row of rows) {
    if (!latest.has(row.kind)) latest.set(row.kind, row);
  }
  return latest;
}

export async function deleteMeasurement(id: string): Promise<void> {
  const deletedAt = Date.now();

  await db
    .update(bodyMeasurements)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(bodyMeasurements.id, id));

  await trackDelete('body_measurements', id, deletedAt);
}
