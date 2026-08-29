/**
 * How to get the file out of the other app.
 *
 * This is half the feature. An importer that works perfectly is useless to
 * someone who cannot find the export button, and that button is three taps deep
 * in an app they are trying to leave, so the instructions live next to the
 * file picker rather than in a support article nobody will go looking for.
 *
 * Menu labels drift. Where a path is documented it is given exactly; where it
 * is not, the wording says so instead of inventing a precise-sounding route
 * that sends the user hunting through the wrong screen.
 */

import type { Ionicons } from '@expo/vector-icons';

import type { ImageSourcePropType } from 'react-native';

/** The apps the picker offers. Narrower than the parser's source detection. */
export type ImportApp = 'strong' | 'hevy' | 'lyfta' | 'lift' | 'other';

export interface ExportGuide {
  app: ImportApp;
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  image?: ImageSourcePropType;
  /** One line under the name in the picker. */
  summary: string;
  steps: string[];
  /** Things that will silently ruin the file if ignored. */
  warnings: string[];
  /** What the picker should accept. */
  mimeTypes: string[];
}

const CSV_MIME_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  // Android hands CSVs picked from Drive and mail attachments back under this,
  // and a picker that filters it out shows the user an empty folder.
  'application/octet-stream',
];

export const EXPORT_GUIDES: Record<ImportApp, ExportGuide> = {
  strong: {
    app: 'strong',
    name: 'Strong',
    image: require('../../../assets/images/brands/Strong_small.webp'),
    summary: 'CSV export, one row per set',
    steps: [
      'Open Strong and go to the Profile tab.',
      'Tap the gear icon in the top right to open Settings.',
      'Scroll down to the "App" section and tap "Export Data".',
      'Strong generates a CSV file of your history. Save it to your phone (Files or Drive), then come back here.',
    ],
    warnings: [
      'Do not open the CSV in Excel or Sheets first. Those apps silently rewrite dates when saving, which will make the file unreadable.',
    ],
    mimeTypes: CSV_MIME_TYPES,
  },

  hevy: {
    app: 'hevy',
    name: 'Hevy',
    image: require('../../../assets/images/brands/hevy_small.webp'),
    summary: 'CSV export, one row per set',
    steps: [
      'Open Hevy and go to the Profile tab.',
      'Tap the gear icon in the top right.',
      'Under Preferences, tap "Export & Import Data".',
      'Tap Export, then "Export Workouts".',
      'Hevy sends the CSV to your share sheet or email. Save it to Files, then come back here.',
    ],
    warnings: [
      'Do not open the file in a spreadsheet app first. Excel and Sheets rewrite the dates on save, which is enough to make every workout unreadable.',
    ],
    mimeTypes: CSV_MIME_TYPES,
  },

  lyfta: {
    app: 'lyfta',
    name: 'Lyfta',
    image: require('../../../assets/images/brands/lyfta_small.webp'),
    summary: 'CSV export of your workout history',
    steps: [
      'Open Lyfta and go to Settings.',
      'Look for the data section. The export sits near "Import Data", and has also appeared under Account and under Data & Privacy.',
      'Export your workouts as CSV and save the file.',
      'If you cannot find it, Lyfta support can send you the export.',
    ],
    warnings: [
      'Do not open the file in a spreadsheet app first.',
    ],
    mimeTypes: CSV_MIME_TYPES,
  },

  lift: {
    app: 'lift',
    name: 'Lift',
    icon: 'phone-portrait-outline',
    summary: 'A backup, a CSV, or one routine from a friend',
    steps: [
      'For everything: on the other phone open Profile → Backup & export, then "Export backup". That carries workouts, routines, records and measurements.',
      'For the training log alone: "Export sets as CSV" on the same screen.',
      'For one routine: open it and tap the share icon in the top right.',
      'For one session: open it in History and tap the share icon.',
      'Send the file to this phone however you like, then pick it below.',
    ],
    warnings: [
      'A backup restores routines, records and measurements as well; the CSV carries sets only.',
      'A shared routine is added as a new routine of your own, and a shared session is added to your log. Neither touches anything already here.',
      'All of these merge into what is already here and overwrite nothing.',
    ],
    mimeTypes: [...CSV_MIME_TYPES, 'application/json'],
  },

  other: {
    app: 'other',
    name: 'Something else',
    icon: 'documents-outline',
    summary: 'Any CSV with a date, an exercise and a set per row',
    steps: [
      'Export your history as CSV from whatever app you use.',
      'It needs a column for the date and one naming the exercise. Weight, reps, set type, RPE, duration and distance are read when present.',
      'Column names are matched loosely. "Weight (kg)", "weight_kg" and "weightKg" are all understood.',
    ],
    warnings: [
      'English column headings only.',
    ],
    mimeTypes: [...CSV_MIME_TYPES, 'application/json'],
  },
};

export const IMPORT_APP_ORDER: ImportApp[] = ['strong', 'hevy', 'lyfta', 'lift', 'other'];
