/**
 * Which exercises a screen shows, in what order, and what it offers first.
 *
 * Pure, and in the shared package rather than in the app, for two reasons: it
 * is the part of the exercise feature that is a judgement rather than a lookup:
 * the part worth running over a fixture and checking, see `ranking.test.ts`,
 * and it is domain logic the API can reach for too. The app's
 * `features/exercises/repository.ts` owns the queries that feed it.
 */

import type { Equipment, MuscleGroup } from '../types.ts';
import { createExerciseMatcher } from './matching.ts';

/** How many exercises the picker offers above the catalog. */
export const SUGGESTION_LIMIT = 8;

/** One exercise appearing in one session. */
export interface TrainingHistoryRow {
  workoutId: string;
  exerciseId: string;
  startedAt: Date;
}

export interface ExerciseUsage {
  /** Sessions this exercise appeared in: not sets, and not rows. */
  uses: number;
  /** Epoch ms of the most recent session containing it. */
  lastUsedAt: number;
}

export type UsageIndex = ReadonlyMap<string, ExerciseUsage>;

export interface TrainingIndex {
  usage: UsageIndex;
  /** Which sessions each exercise appeared in, for co-occurrence. */
  sessionsByExercise: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * What suggesting needs to know about an exercise.
 *
 * Structural rather than the schema's `Exercise`, so a screen can keep
 * selecting the handful of columns it draws and still rank with them.
 */
export interface RankableExercise {
  id: string;
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  isArchived: boolean;
}

/** What filtering needs on top of that. */
export interface FilterableExercise extends RankableExercise {
  equipment: Equipment;
  isCustom: boolean;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface ExerciseFilters {
  search?: string;
  /**
   * Any of these muscles, as primary or secondary. Empty means no constraint.
   * "shoulders or triceps" is one training decision, and a single-value filter
   * made the user run the search twice and hold the first half in their head.
   */
  muscles?: readonly MuscleGroup[];
  /** Any of these. Empty means no constraint. */
  equipment?: readonly Equipment[];
  customOnly?: boolean;
  includeArchived?: boolean;
}

// ---------------------------------------------------------------------------
// How canonical a name is
// ---------------------------------------------------------------------------

/**
 * How many names in the library each word appears in.
 *
 * The tie-break problem this solves: within one match tier, nothing in the data
 * said which of "Barbell Squat" and "U Squat" a person searching "squat" meant.
 * Ordering by name gave the alphabet and ordering by length gave the shortest
 * qualifier, and both are arbitrary dressed up as an answer: "squat" opened on
 * U Squat, Air Squat and Sit Squat, and "row" on Lever Row and Pulse Row.
 *
 * Word frequency is the signal the catalog does carry. Every row is a movement
 * plus qualifiers, and the qualifiers of a canonical entry are the ones the
 * catalog uses constantly: "dumbbell" appears in hundreds of names, "u" and
 * "sit" in a handful. So a name built from common words is a mainstream variant
 * and a name built from rare ones is a corner of the catalog, which is exactly
 * the question a tie-break here has to answer.
 *
 * A name is scored by its *rarest* word rather than its average, because one
 * odd word is what makes an entry obscure and averaging lets the common words
 * around it hide that.
 */
type WordFrequency = ReadonlyMap<string, number>;

/**
 * Memoised on the row array's identity, not copied into it.
 *
 * Building costs ~14ms over the real catalog, which is affordable once and not
 * per keystroke. Screens hand `filterExercises` the same array from one live
 * query for as long as the table is unchanged, so the cache holds across every
 * search, and a `WeakMap` means a superseded array takes its index with it. The
 * function stays pure: the same rows still produce the same answer, this only
 * stops it recomputing the same thing.
 *
 * Built lazily, and only from the search branch. Browsing never needs it.
 */
const wordFrequencyCache = new WeakMap<object, WordFrequency>();

function wordFrequency(rows: readonly RankableExercise[]): WordFrequency {
  const cached = wordFrequencyCache.get(rows);
  if (cached) return cached;

  const frequency = new Map<string, number>();
  for (const row of rows) {
    // Per name, not per occurrence: "Squat Squat Jump" must not make "squat"
    // look commoner than it is.
    for (const token of new Set(nameTokens(row.name))) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  wordFrequencyCache.set(rows, frequency);
  return frequency;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** What a name adds on top of the query, which is what ranks it within a tier. */
interface Qualifiers {
  /** How many words the name has that the query did not ask for. Fewer is better. */
  count: number;
  /**
   * How common the rarest of those words is across the library. Higher is
   * better. `Infinity` when there are none, which means the name is exactly the
   * query: the honest value rather than a sentinel, since a name made of no
   * unusual words cannot be beaten on this key.
   */
  commonness: number;
}

/**
 * The query's own words are skipped throughout: they are in every row being
 * compared, so counting them would add the same amount to all of them.
 *
 * Count is read before commonness, and the order of those two is not
 * interchangeable. Commonness alone answered "press" with Squat Press-up and
 * Dumbbell Press Squat, because "squat", "dumbbell" and "up" are among the
 * commonest words in the catalog, so piling more of them on scored *better*.
 * Counting first says what that missed: a name that adds one word to the query
 * is a variant of it, and a name that adds three is a different exercise that
 * happens to contain it. Commonness then picks the mainstream variant from
 * among the ones that added equally little, which is the job it is good at, and
 * is what keeps "Dumbbell Squat" above "U Squat".
 */
function qualifiers(
  name: string,
  queryTokens: readonly string[],
  frequency: WordFrequency,
): Qualifiers {
  let count = 0;
  let commonness = Infinity;

  for (const token of nameTokens(name)) {
    if (queryTokens.includes(token)) continue;
    count += 1;
    const seen = frequency.get(token) ?? 0;
    if (seen < commonness) commonness = seen;
  }

  return { count, commonness };
}

/**
 * Filters and orders an already-loaded library.
 *
 * Kept pure and separate from the query so screens can drive it from
 * `useLiveQuery`: the list then re-filters reactively as rows change, without
 * a database round-trip per keystroke.
 *
 * Everything per-query is hoisted out of the per-row loop: the matcher compiles
 * the search once, the filter values become Sets before iterating rather than
 * being re-scanned 6,800 times. Callers should hand this a *deferred* search
 * value. Even at this cost it is too much work to run synchronously between
 * two keystrokes.
 *
 * `usage` is what stops a browse from being 6,800 rows in alphabetical order,
 * which is a catalog rather than an answer: the lifts this person actually
 * trains come first, and the rest keep their alphabetical run underneath.
 */
export function filterExercises<T extends FilterableExercise>(
  rows: readonly T[],
  filters: ExerciseFilters = {},
  usage?: UsageIndex,
): T[] {
  const { search, muscles, equipment, customOnly, includeArchived } = filters;

  const muscleSet = muscles && muscles.length > 0 ? new Set(muscles) : null;
  const equipmentSet = equipment && equipment.length > 0 ? new Set(equipment) : null;

  const result = rows.filter((row) => {
    if (!includeArchived && row.isArchived) return false;
    if (customOnly && !row.isCustom) return false;
    if (equipmentSet && !equipmentSet.has(row.equipment)) return false;
    if (muscleSet && !matchesMuscles(row, muscleSet)) return false;
    return true;
  });

  const match = search ? createExerciseMatcher(search) : null;
  if (match) {
    const frequency = wordFrequency(rows);
    const queryTokens = nameTokens(search ?? '');

    // One array of scored entries rather than map → filter → sort → map, which
    // allocated four intermediate arrays of up to 6,800 elements per keystroke.
    // The qualifiers are computed here rather than in the comparator because a
    // sort asks for each element's keys O(log n) times, and this one tokenises.
    const scored: { row: T; score: number; extra: Qualifiers }[] = [];
    for (const row of result) {
      const score = match(row.name);
      if (score > 0) {
        scored.push({ row, score, extra: qualifiers(row.name, queryTokens, frequency) });
      }
    }

    /*
     * Four keys, and the order of them is the ranking.
     *
     * Usage breaks ties *within* a match tier only. It must never outrank the
     * text score: someone typing "squat" is naming the row they want, and
     * burying it under a lift they happen to do more often is the search
     * failing at the one thing it was asked to do.
     *
     * The two qualifier keys are what make a tier an order rather than a heap:
     * how much the name adds to the query, then how mainstream what it added
     * is. See `qualifiers`. Both sit below usage, because what this person
     * actually trains beats anything the catalog's own shape can say.
     *
     * Length then separates rows those cannot, which is mostly the same words
     * spelled longer. Name last, and only to keep the order stable between two
     * renders of the same query.
     */
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        uses(usage, b.row.id) - uses(usage, a.row.id) ||
        a.extra.count - b.extra.count ||
        b.extra.commonness - a.extra.commonness ||
        a.row.name.length - b.row.name.length ||
        a.row.name.localeCompare(b.row.name),
    );
    return scored.map((entry) => entry.row);
  }

  if (!usage || usage.size === 0) return result;

  // Partitioned rather than sorted. A comparator over the whole catalog is
  // ~6,800 log 6,800 comparisons for the sake of the few dozen rows that have
  // any history at all; splitting the list is one pass, and the untrained
  // remainder keeps the alphabetical order the query already put it in.
  const trained: T[] = [];
  const rest: T[] = [];
  for (const row of result) (usage.has(row.id) ? trained : rest).push(row);

  trained.sort((a, b) => uses(usage, b.id) - uses(usage, a.id) || a.name.localeCompare(b.name));

  return [...trained, ...rest];
}

function matchesMuscles(row: RankableExercise, muscles: ReadonlySet<MuscleGroup>): boolean {
  if (muscles.has(row.primaryMuscle)) return true;
  for (const secondary of row.secondaryMuscles) {
    if (muscles.has(secondary)) return true;
  }
  return false;
}

function uses(usage: UsageIndex | undefined, id: string): number {
  return usage?.get(id)?.uses ?? 0;
}

/**
 * Exercises per muscle, counting one exercise once for every muscle it works.
 *
 * Secondary muscles are included because the filter includes them: picking
 * "Triceps" returns the close-grip bench presses that never list triceps as
 * primary, so a count drawn from primaries alone would understate the answer
 * it labels.
 */
export function countExercisesPerMuscle(
  rows: readonly RankableExercise[],
): Partial<Record<MuscleGroup, number>> {
  const counts: Partial<Record<MuscleGroup, number>> = {};

  for (const exercise of rows) {
    if (exercise.isArchived) continue;
    counts[exercise.primaryMuscle] = (counts[exercise.primaryMuscle] ?? 0) + 1;
    for (const secondary of exercise.secondaryMuscles) {
      if (secondary === exercise.primaryMuscle) continue;
      counts[secondary] = (counts[secondary] ?? 0) + 1;
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const EMPTY_INDEX: TrainingIndex = { usage: new Map(), sessionsByExercise: new Map() };

/**
 * Rolls the raw appearances up once, for every consumer of them.
 *
 * Sessions are held as a Set per exercise rather than a count, because the
 * co-occurrence score needs the identities: "how many of the sessions that
 * contained a bench press also contained this" cannot be answered from a
 * number. `uses` then falls out as the set's size, which also makes it immune
 * to an exercise added twice in one session: a superset, or a lift revisited
 * at the end. Where counting rows would have called it two sessions.
 */
export function buildTrainingIndex(rows: readonly TrainingHistoryRow[]): TrainingIndex {
  if (rows.length === 0) return EMPTY_INDEX;

  const sessionsByExercise = new Map<string, Set<string>>();
  const lastUsed = new Map<string, number>();

  for (const row of rows) {
    let sessions = sessionsByExercise.get(row.exerciseId);
    if (!sessions) {
      sessions = new Set();
      sessionsByExercise.set(row.exerciseId, sessions);
    }
    sessions.add(row.workoutId);

    const at = row.startedAt.getTime();
    if (at > (lastUsed.get(row.exerciseId) ?? 0)) lastUsed.set(row.exerciseId, at);
  }

  const usage = new Map<string, ExerciseUsage>();
  for (const [exerciseId, sessions] of sessionsByExercise) {
    usage.set(exerciseId, { uses: sessions.size, lastUsedAt: lastUsed.get(exerciseId) ?? 0 });
  }

  return { usage, sessionsByExercise };
}

const DAY_MS = 86_400_000;

/**
 * How much a lift's recency is worth, in tiers rather than as a curve.
 *
 * A programme runs on a week or two of rotation, so "trained since last week"
 * and "trained three months ago" are genuinely different facts while "nine
 * days" and "eleven days" are not. Stepping the score keeps the order stable
 * across a session instead of quietly reshuffling as the clock moves.
 */
function recencyScore(lastUsedAt: number, now: number): number {
  const days = (now - lastUsedAt) / DAY_MS;
  if (days <= 10) return 1;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.3;
  return 0;
}

export interface SuggestionInput<T extends RankableExercise> {
  /** The library to draw from: already loaded by the calling screen. */
  catalog: readonly T[];
  index: TrainingIndex;
  /** Exercises already in the session or routine being built. */
  context?: readonly string[];
  limit?: number;
  /** Injectable for tests; defaults to the wall clock. */
  now?: number;
}

/**
 * The handful of exercises worth offering before the catalog.
 *
 * The list this replaced was the eight most recently trained lifts, which is
 * one signal used alone: it answers "what did I do last week" when the question
 * standing at the rack is "what goes with what I am already doing today".
 *
 * Four signals, weighted:
 *
 * - **Co-occurrence** (0.45): of the past sessions that contained something
 *   already in this workout, how many also contained this. This is the one that
 *   makes the block feel like it knows the programme: add a bench press and the
 *   rows, flyes and triceps work you actually pair it with come up, in the order
 *   you actually pair them.
 * - **Frequency** (0.25): sessions containing it, over the most any exercise
 *   has. Your staples should not fall off the list on a day whose context is
 *   thin.
 * - **Muscle overlap** (0.15). Carries the block on day one, before there is
 *   any history to co-occur with. Without it a first-time user gets an empty
 *   suggestion section, which is exactly when the catalog is most daunting.
 * - **Recency** (0.15): separates the current block from lifts that were
 *   staples a year ago.
 *
 * Anything already in the workout is excluded: it is the one set of exercises
 * the user demonstrably does not need offered back.
 */
export function suggestExercises<T extends RankableExercise>({
  catalog,
  index,
  context = [],
  limit = SUGGESTION_LIMIT,
  now = Date.now(),
}: SuggestionInput<T>): T[] {
  const excluded = new Set(context);

  // Sessions that contained anything already in this workout: the denominator
  // for co-occurrence, and the reason an unrelated staple can't crowd it out.
  const contextSessions = new Set<string>();
  for (const id of context) {
    const sessions = index.sessionsByExercise.get(id);
    if (sessions) for (const session of sessions) contextSessions.add(session);
  }

  // Muscles the current workout is already working, so day-one suggestions land
  // on the same body part rather than anywhere in the catalog.
  const contextMuscles = new Set<MuscleGroup>();
  if (context.length > 0) {
    const byId = new Map(catalog.map((row) => [row.id, row]));
    for (const id of context) {
      const exercise = byId.get(id);
      if (!exercise) continue;
      contextMuscles.add(exercise.primaryMuscle);
      for (const secondary of exercise.secondaryMuscles) contextMuscles.add(secondary);
    }
  }

  let maxUses = 0;
  for (const entry of index.usage.values()) {
    if (entry.uses > maxUses) maxUses = entry.uses;
  }

  const scored: { row: T; score: number }[] = [];

  for (const row of catalog) {
    if (row.isArchived || excluded.has(row.id)) continue;

    const usage = index.usage.get(row.id);
    const sessions = index.sessionsByExercise.get(row.id);

    let shared = 0;
    if (sessions && contextSessions.size > 0) {
      // Iterating the exercise's own sessions, which is the smaller side by a
      // wide margin: a lift appears in tens of sessions, the context union in
      // hundreds.
      for (const session of sessions) {
        if (contextSessions.has(session)) shared += 1;
      }
    }

    const co = contextSessions.size > 0 ? shared / contextSessions.size : 0;
    const frequency = usage && maxUses > 0 ? usage.uses / maxUses : 0;
    const related = muscleOverlap(row, contextMuscles);
    const recency = usage ? recencyScore(usage.lastUsedAt, now) : 0;

    const score = 0.45 * co + 0.25 * frequency + 0.15 * related + 0.15 * recency;
    if (score > 0) scored.push({ row, score });
  }

  // Name breaks the remaining ties so the block is stable between two opens of
  // the picker within one session. Nothing moves under a thumb already on its
  // way to a row.
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));

  return scored.slice(0, limit).map((entry) => entry.row);
}

function muscleOverlap(exercise: RankableExercise, muscles: ReadonlySet<MuscleGroup>): number {
  if (muscles.size === 0) return 0;
  if (muscles.has(exercise.primaryMuscle)) return 1;
  for (const secondary of exercise.secondaryMuscles) {
    if (muscles.has(secondary)) return 0.5;
  }
  return 0;
}
