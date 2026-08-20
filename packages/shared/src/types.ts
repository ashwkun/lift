/**
 * Core domain vocabulary, shared by the mobile app, the API and the sync engine.
 *
 * These are plain const tuples rather than TS enums so they can be iterated at
 * runtime (filter chips, pickers, seed validation) while still producing exact
 * union types.
 */

// ---------------------------------------------------------------------------
// Muscles
// ---------------------------------------------------------------------------

export const MUSCLE_GROUPS = [
  'chest',
  'lats',
  'upper_back',
  'lower_back',
  'traps',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'adductors',
  'abductors',
  'neck',
  'cardio',
  'full_body',
  'other',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  lats: 'Lats',
  upper_back: 'Upper Back',
  lower_back: 'Lower Back',
  traps: 'Trapezius',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abdominals',
  obliques: 'Obliques',
  quads: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  abductors: 'Abductors',
  neck: 'Neck',
  cardio: 'Cardio',
  full_body: 'Full Body',
  other: 'Other',
};

/** Coarse grouping used by the muscle-distribution chart. */
export const BODY_PARTS = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs', 'other'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const MUSCLE_TO_BODY_PART: Record<MuscleGroup, BodyPart> = {
  chest: 'chest',
  lats: 'back',
  upper_back: 'back',
  lower_back: 'back',
  traps: 'back',
  shoulders: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  abs: 'core',
  obliques: 'core',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  adductors: 'legs',
  abductors: 'legs',
  neck: 'other',
  cardio: 'other',
  full_body: 'other',
  other: 'other',
};

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'smith_machine',
  'plate',
  'resistance_band',
  'suspension',
  'medicine_ball',
  'bodyweight',
  'cardio_machine',
  'other',
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  machine: 'Machine',
  cable: 'Cable',
  smith_machine: 'Smith Machine',
  plate: 'Weight Plate',
  resistance_band: 'Resistance Band',
  suspension: 'Suspension',
  medicine_ball: 'Medicine Ball',
  bodyweight: 'Bodyweight',
  cardio_machine: 'Cardio Machine',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Exercise tracking
// ---------------------------------------------------------------------------

/**
 * Determines which input fields the set row renders and how volume is derived.
 * This is the single most important field on an exercise — getting it wrong
 * means the logger asks for weight on a plank.
 */
export const TRACKING_TYPES = [
  'weight_reps', // Barbell bench press — weight × reps
  'bodyweight_reps', // Push-ups — reps, bodyweight counts toward volume
  'weighted_bodyweight', // Weighted pull-ups — bodyweight + added weight
  'assisted_bodyweight', // Assisted dips — bodyweight − assistance
  'duration', // Plank — time only
  'distance_duration', // Running — distance + time
  'weight_distance', // Farmer's walk — weight + distance
  'reps_only', // Any untimed, unloaded rep count
] as const;

export type TrackingType = (typeof TRACKING_TYPES)[number];

/** Which numeric columns a given tracking type actually uses. */
export const TRACKING_FIELDS: Record<
  TrackingType,
  { weight: boolean; reps: boolean; duration: boolean; distance: boolean }
> = {
  weight_reps: { weight: true, reps: true, duration: false, distance: false },
  bodyweight_reps: { weight: false, reps: true, duration: false, distance: false },
  weighted_bodyweight: { weight: true, reps: true, duration: false, distance: false },
  assisted_bodyweight: { weight: true, reps: true, duration: false, distance: false },
  duration: { weight: false, reps: false, duration: true, distance: false },
  distance_duration: { weight: false, reps: false, duration: true, distance: true },
  weight_distance: { weight: true, reps: false, duration: false, distance: true },
  reps_only: { weight: false, reps: true, duration: false, distance: false },
};

/**
 * Tracking types whose volume is a function of the lifter's bodyweight.
 *
 * `TRACKING_FIELDS` cannot express this: it describes what the *set row* asks
 * for, and bodyweight is asked for once in Settings rather than per set. The
 * two disagree in both directions — `bodyweight_reps` renders no weight field
 * yet its entire volume is bodyweight, while `weight_reps` renders one and
 * ignores bodyweight completely. A push-up session with no bodyweight on record
 * therefore logs zero volume, so anything that writes or prompts for the value
 * keys off this set instead.
 */
export const USES_BODYWEIGHT: ReadonlySet<TrackingType> = new Set<TrackingType>([
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
]);

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export const SET_TYPES = ['normal', 'warmup', 'drop', 'failure'] as const;
export type SetType = (typeof SET_TYPES)[number];

/** Single-character badge shown in the set-number column, Hevy-style. */
export const SET_TYPE_BADGE: Record<SetType, string | null> = {
  normal: null, // shows the working-set ordinal instead
  warmup: 'W',
  drop: 'D',
  failure: 'F',
};

export const SET_TYPE_LABELS: Record<SetType, string> = {
  normal: 'Normal Set',
  warmup: 'Warm-up Set',
  drop: 'Drop Set',
  failure: 'Failure Set',
};

/**
 * Warm-up sets are excluded from volume, PR detection and 1RM estimates —
 * counting them would inflate every stat in the app.
 */
export function isWorkingSet(setType: SetType): boolean {
  return setType !== 'warmup';
}

// ---------------------------------------------------------------------------
// Units & preferences
// ---------------------------------------------------------------------------

export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DISTANCE_UNITS = ['km', 'mi'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

export const MEASUREMENT_UNITS = ['cm', 'in'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

export const PR_KINDS = [
  'heaviest_weight', // highest weight moved for any working set
  'best_1rm', // highest estimated one-rep max
  'best_set_volume', // highest weight × reps in a single set
  'best_session_volume', // highest total volume for the exercise in one workout
  'most_reps', // highest rep count at any weight
  'best_duration', // longest hold / fastest depending on exercise
  'best_distance',
] as const;

export type PrKind = (typeof PR_KINDS)[number];

export const PR_KIND_LABELS: Record<PrKind, string> = {
  heaviest_weight: 'Heaviest Weight',
  best_1rm: 'Best Est. 1RM',
  best_set_volume: 'Best Set Volume',
  best_session_volume: 'Best Session Volume',
  most_reps: 'Most Reps',
  best_duration: 'Best Duration',
  best_distance: 'Best Distance',
};

// ---------------------------------------------------------------------------
// Body measurements
// ---------------------------------------------------------------------------

export const MEASUREMENT_KINDS = [
  'bodyweight',
  'body_fat',
  'neck',
  'shoulders',
  'chest',
  'left_bicep',
  'right_bicep',
  'left_forearm',
  'right_forearm',
  'waist',
  'hips',
  'left_thigh',
  'right_thigh',
  'left_calf',
  'right_calf',
] as const;

export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

export const MEASUREMENT_KIND_LABELS: Record<MeasurementKind, string> = {
  bodyweight: 'Bodyweight',
  body_fat: 'Body Fat %',
  neck: 'Neck',
  shoulders: 'Shoulders',
  chest: 'Chest',
  left_bicep: 'Left Bicep',
  right_bicep: 'Right Bicep',
  left_forearm: 'Left Forearm',
  right_forearm: 'Right Forearm',
  waist: 'Waist',
  hips: 'Hips',
  left_thigh: 'Left Thigh',
  right_thigh: 'Right Thigh',
  left_calf: 'Left Calf',
  right_calf: 'Right Calf',
};
