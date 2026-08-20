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
import { useSettings } from '@/store/settings';

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

  return row;
}

/** Records a bodyweight and mirrors it into settings. */
export async function recordBodyweight(kg: number): Promise<BodyMeasurement> {
  return recordMeasurement({ kind: 'bodyweight', value: kg });
}

/**
 * Copies the newest bodyweight into the settings store.
 *
 * Volume for push-ups, pull-ups and dips is computed from
 * `settings.bodyweightKg`, and until this existed nothing ever wrote it — a
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
}
