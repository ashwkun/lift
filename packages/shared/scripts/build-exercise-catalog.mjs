#!/usr/bin/env node
/**
 * Regenerates `src/exercises/catalog.ts` from the LiftShift exercise CSV.
 *
 *   node scripts/build-exercise-catalog.mjs <path-to.csv>
 *
 * Source: https://github.com/aree6/LiftShift
 *   frontend/public/exercises_muscles_and_thumbnail_data.csv
 *
 * The CSV is upstream data with upstream problems: two different asset hosts,
 * the literal string "None" used for empty cells, muscles named both
 * anatomically (`gluteus_maximus`) and in this app's own vocabulary (`Glutes`),
 * 41 equipment spellings for 13 real categories, and names that collide once
 * slugified. Everything below exists to normalise one of those.
 *
 * This is a build step, not runtime code — it runs on a developer machine and
 * its output is committed, so the app never parses a CSV.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/exercises/catalog.ts');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The CSV writes empty cells as the literal "None" as often as it leaves them blank. */
function cell(value) {
  const trimmed = (value ?? '').trim();
  return trimmed === '' || trimmed === 'None' ? '' : trimmed;
}

// ---------------------------------------------------------------------------
// Vocabulary — must stay in step with MUSCLE_GROUPS / EQUIPMENT in types.ts
// ---------------------------------------------------------------------------

const MUSCLE_GROUPS = [
  'chest', 'lats', 'upper_back', 'lower_back', 'traps', 'shoulders', 'biceps',
  'triceps', 'forearms', 'abs', 'obliques', 'quads', 'hamstrings', 'glutes',
  'calves', 'adductors', 'abductors', 'neck', 'cardio', 'full_body', 'other',
];

const EQUIPMENT = [
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'smith_machine',
  'plate', 'resistance_band', 'suspension', 'medicine_ball', 'bodyweight',
  'cardio_machine', 'other',
];

const TRACKING_TYPES = [
  'weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight',
  'duration', 'distance_duration', 'weight_distance', 'reps_only',
];

/** Every muscle token that appears in the CSV, mapped to this app's groups. */
const MUSCLE_MAP = {
  // anatomical
  quadriceps: 'quads',
  sartorius: 'quads',
  gluteus_maximus: 'glutes',
  hamstrings: 'hamstrings',
  trapezius: 'traps',
  deltoid_anterior: 'shoulders',
  deltoid_lateral: 'shoulders',
  deltoid_posterior: 'shoulders',
  deltoids: 'shoulders',
  rectus_abdominis: 'abs',
  obliques: 'obliques',
  iliopsoas: 'abs',
  triceps: 'triceps',
  biceps: 'biceps',
  brachialis: 'biceps',
  brachioradialis: 'forearms',
  wrist_flexors: 'forearms',
  wrist_extensors: 'forearms',
  latissimus_dorsi: 'lats',
  teres_major: 'upper_back',
  teres_minor: 'upper_back',
  infraspinatus: 'upper_back',
  erector_spinae: 'lower_back',
  chest_clavicular_head: 'chest',
  chest_sternal_head: 'chest',
  serratus_anterior: 'chest',
  soleus: 'calves',
  gastrocnemius: 'calves',
  tibias: 'calves',
  hip_adductors: 'adductors',
  hip_abductors: 'abductors',
  tensor_fasciae_femoris: 'abductors',
  // already in this app's vocabulary, just capitalised
  Chest: 'chest', Lats: 'lats', 'Upper Back': 'upper_back', 'Lower Back': 'lower_back',
  Traps: 'traps', Shoulders: 'shoulders', Biceps: 'biceps', Triceps: 'triceps',
  Forearms: 'forearms', Abdominals: 'abs', Obliques: 'obliques', Quadriceps: 'quads',
  Hamstrings: 'hamstrings', Glutes: 'glutes', Calves: 'calves', Adductors: 'adductors',
  Abductors: 'abductors', Neck: 'neck', Cardio: 'cardio', 'Full Body': 'full_body',
  Other: 'other',
};

const EQUIPMENT_MAP = {
  Barbell: 'barbell', 'EZ Barbell': 'barbell', 'Olympic barbell': 'barbell', 'Trap bar': 'barbell',
  Dumbbell: 'dumbbell',
  Kettlebell: 'kettlebell',
  Cable: 'cable',
  'Leverage machine': 'machine', Machine: 'machine', 'Sled machine': 'machine',
  'Power Sled': 'machine', Hammer: 'machine',
  'Smith machine': 'smith_machine',
  Plate: 'plate', 'Vibrate Plate': 'plate',
  Band: 'resistance_band', 'Resistance Band': 'resistance_band',
  Suspension: 'suspension',
  'Medicine Ball': 'medicine_ball',
  'Body weight': 'bodyweight', Weighted: 'bodyweight', Assisted: 'bodyweight',
  // Props with no category of their own. `other` is honest; inventing an
  // equipment type per prop would bloat the filter UI for 78 exercises.
  Roll: 'other', Rollball: 'other', 'Wheel roller': 'other', 'Stability ball': 'other',
  'Bosu ball': 'other', Stick: 'other', Rope: 'other', 'Battling Rope': 'other', Other: 'other',
};

/** Isometric holds are tracked as time, not reps. */
const DURATION_NAME = /\b(plank|hold|hang|wall sit|isometric|bridge hold|static)\b/i;

/**
 * Last-resort primary muscle, guessed from the exercise name.
 *
 * 602 rows arrive with an empty `primary_muscle`. Falling back to the first
 * listed *secondary* is not good enough: the source lists secondaries in
 * anatomical order rather than by importance, so "Barbell Bench Press"
 * (secondary: deltoid_anterior, chest_clavicular_head, triceps) would come out
 * as a shoulder exercise.
 *
 * Applied ONLY when the primary cell is blank, so it can never override real
 * upstream data. First match wins, hence the ordering — "leg curl" has to be
 * tested before the generic "curl".
 */
const NAME_HINTS = [
  [/\b(bench press|chest press|push[- ]?up|pec deck|chest fly|chest flye)\b/i, 'chest'],
  [/\b(lat pulldown|pulldown|pull[- ]?up|chin[- ]?up)\b/i, 'lats'],
  [/\brow\b/i, 'upper_back'],
  [/\b(shrug)\b/i, 'traps'],
  [/\b(leg curl|lying curl|romanian deadlift|rdl|good morning)\b/i, 'hamstrings'],
  [/\b(leg extension)\b/i, 'quads'],
  [/\b(squat|lunge|leg press|step[- ]?up|split squat)\b/i, 'quads'],
  [/\b(hip thrust|glute bridge|glute kickback|hip extension)\b/i, 'glutes'],
  [/\bdeadlift\b/i, 'hamstrings'],
  [/\b(calf raise|calf press|heel raise)\b/i, 'calves'],
  [/\b(tricep|triceps|skull ?crusher|pushdown|press[- ]?down|kickback|dip)\b/i, 'triceps'],
  [/\b(wrist|reverse curl|hammer curl)\b/i, 'forearms'],
  [/\bcurl\b/i, 'biceps'],
  [/\b(shoulder press|overhead press|military press|lateral raise|front raise|upright row|arnold press)\b/i, 'shoulders'],
  [/\b(crunch|sit[- ]?up|leg raise|plank|hollow|v[- ]?up|ab wheel)\b/i, 'abs'],
  [/\b(twist|side bend|woodchop|oblique)\b/i, 'obliques'],
  [/\b(run|jog|sprint|cycle|bike|elliptical|jump rope|burpee)\b/i, 'cardio'],
  [/\b(neck)\b/i, 'neck'],
];

function guessPrimaryFromName(name) {
  for (const [pattern, muscle] of NAME_HINTS) {
    if (pattern.test(name)) return muscle;
  }
  return null;
}

function mapMuscles(raw) {
  const out = [];
  for (const token of raw.split(',')) {
    const key = token.trim();
    if (!key) continue;
    const mapped = MUSCLE_MAP[key];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function mapEquipment(raw) {
  // An empty equipment cell means "nothing required" far more often than it
  // means "unknown" — those rows are push-ups, crunches and stretches.
  if (!raw) return 'bodyweight';

  // Combination cells ("Assisted, Body weight") take the first recognised token.
  for (const token of raw.split(',')) {
    const mapped = EQUIPMENT_MAP[token.trim()];
    if (mapped) return mapped;
  }
  return 'other';
}

function trackingFor(rawEquipment, equipment, primary, name) {
  const tokens = rawEquipment.split(',').map((t) => t.trim());
  if (tokens.includes('Assisted')) return 'assisted_bodyweight';
  if (tokens.includes('Weighted')) return 'weighted_bodyweight';
  if (primary === 'cardio') return 'distance_duration';
  if (DURATION_NAME.test(name)) return 'duration';
  if (equipment === 'bodyweight' || rawEquipment === '') return 'bodyweight_reps';
  return 'weight_reps';
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: build-exercise-catalog.mjs <path-to.csv>');
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows[0].map((h) => h.trim());
const col = (name) => header.indexOf(name);
const iName = col('name');
const iEquip = col('equipment');
const iPrimary = col('primary_muscle');
const iSecondary = col('secondary_muscle');
const iVideo = col('video');
const iThumb = col('thumbnail');

/**
 * Asset URLs share a handful of directory prefixes across ~6,800 rows. Emitting
 * each prefix once and storing an index plus the filename cuts roughly 700KB of
 * repeated host strings out of the bundle.
 */
const prefixes = [];
function splitUrl(url) {
  if (!url) return [-1, ''];
  const cut = url.lastIndexOf('/') + 1;
  if (cut <= 0) return [-1, ''];
  const prefix = url.slice(0, cut);
  let index = prefixes.indexOf(prefix);
  if (index === -1) index = prefixes.push(prefix) - 1;
  return [index, url.slice(cut)];
}

const seen = new Map();
const entries = [];
const stats = { rows: 0, skipped: 0, deduped: 0, video: 0, thumb: 0, noMuscle: 0, recovered: 0 };

for (const row of rows.slice(1)) {
  if (row.length < header.length) continue;

  const name = cell(row[iName]);
  if (!name) {
    stats.skipped += 1;
    continue;
  }
  stats.rows += 1;

  const rawEquipment = cell(row[iEquip]);
  const equipment = mapEquipment(rawEquipment);

  const primaries = mapMuscles(cell(row[iPrimary]));
  const secondaries = mapMuscles(cell(row[iSecondary]));

  // Blank primary: guess from the name, else promote the first secondary, else
  // give up and say `other`.
  let primary = primaries[0];
  if (!primary) {
    stats.noMuscle += 1;
    primary = guessPrimaryFromName(name) ?? secondaries[0] ?? 'other';
    if (primary !== 'other') stats.recovered += 1;
  }

  // A multi-valued primary cell ("gluteus_maximus, quadriceps") keeps its first
  // entry as the primary and demotes the rest, rather than discarding them.
  const secondary = [...new Set([...primaries.slice(1), ...secondaries])].filter(
    (m) => m !== primary,
  );

  const tracking = trackingFor(rawEquipment, equipment, primary, name);

  let id = slugify(name);
  if (seen.has(id)) {
    stats.deduped += 1;
    const withEquipment = `${id}-${equipment.replace(/_/g, '-')}`;
    if (!seen.has(withEquipment)) {
      id = withEquipment;
    } else {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
  }
  seen.set(id, true);

  const [videoPrefix, videoFile] = splitUrl(cell(row[iVideo]));
  const [thumbPrefix, thumbFile] = splitUrl(cell(row[iThumb]));
  if (videoFile) stats.video += 1;
  if (thumbFile) stats.thumb += 1;

  entries.push([
    id,
    name,
    EQUIPMENT.indexOf(equipment),
    MUSCLE_GROUPS.indexOf(primary),
    secondary.map((m) => MUSCLE_GROUPS.indexOf(m)),
    TRACKING_TYPES.indexOf(tracking),
    videoPrefix,
    videoFile,
    thumbPrefix,
    thumbFile,
  ]);
}

const json = (value) => JSON.stringify(value);
const body = entries
  .map((e) => `[${json(e[0])},${json(e[1])},${e[2]},${e[3]},[${e[4].join(',')}],${e[5]},${e[6]},${json(e[7])},${e[8]},${json(e[9])}]`)
  .join(',\n');

writeFileSync(
  OUT,
  `/**
 * Generated by \`scripts/build-exercise-catalog.mjs\` — do not edit by hand.
 *
 * Source: https://github.com/aree6/LiftShift
 *   frontend/public/exercises_muscles_and_thumbnail_data.csv
 *
 * Stored as positional tuples with enum *indices* rather than objects with
 * string values. Across ${entries.length} exercises that is the difference between a
 * catalog that costs a few hundred KB in the bundle and one that costs several
 * MB — this file is parsed on every cold start, so its size is felt.
 *
 * Tuple: [id, name, equipment, primaryMuscle, secondaryMuscles, trackingType,
 *         videoPrefix, videoFile, thumbnailPrefix, thumbnailFile]
 * Enum fields are indices into EQUIPMENT / MUSCLE_GROUPS / TRACKING_TYPES.
 * A prefix of -1 means the source had no asset for that row.
 */

/** Shared directory prefixes for the media URLs, indexed by the tuples below. */
export const ASSET_PREFIXES: readonly string[] = ${JSON.stringify(prefixes, null, 2)};

export type CatalogEntry = readonly [
  id: string,
  name: string,
  equipment: number,
  primaryMuscle: number,
  secondaryMuscles: readonly number[],
  trackingType: number,
  videoPrefix: number,
  videoFile: string,
  thumbnailPrefix: number,
  thumbnailFile: string,
];

export const EXERCISE_CATALOG: readonly CatalogEntry[] = [
${body},
];
`,
  'utf8',
);

const pct = (n) => `${((n / entries.length) * 100).toFixed(1)}%`;
console.log(`wrote ${OUT}`);
console.log(`  exercises   ${entries.length}  (from ${stats.rows} rows, ${stats.skipped} unnamed skipped)`);
console.log(`  slug clashes resolved ${stats.deduped}`);
console.log(`  with video  ${stats.video} (${pct(stats.video)})`);
console.log(`  with thumb  ${stats.thumb} (${pct(stats.thumb)})`);
console.log(`  blank primary muscle  ${stats.noMuscle} (recovered ${stats.recovered}, left as 'other' ${stats.noMuscle - stats.recovered})`);
console.log(`  asset prefixes ${prefixes.length}`);
