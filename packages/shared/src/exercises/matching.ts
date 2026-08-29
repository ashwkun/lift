/**
 * Name search over the exercise catalog.
 *
 * Split out of `index.ts` so the ranking module can compile a query without
 * importing the 6,800-row catalog expansion that lives alongside it.
 */

/** Scores one name against a query already compiled by `createExerciseMatcher`. */
export type ExerciseMatcher = (name: string) => number;

/**
 * Relevance tiers, widest gap first.
 *
 * Exported so the ranker can reason about them and the tests can name them
 * rather than assert on magic numbers.
 */
export const MATCH_SCORES = {
  /** The name is the query. */
  exact: 1000,
  /** The query is one of the name's words: "row" in "Barbell Row". */
  wholeWord: 800,
  /** The name opens with the query, mid-word: "row" in "Rowing". */
  prefix: 500,
  /** The query starts a word somewhere in the name: "row" in "Rowing Machine". */
  wordStart: 250,
  /** The query is in there somewhere: "row" in "Throw Down". */
  substring: 100,
  /** Every word of the query is present, in any order. */
  allTokens: 50,
} as const;

/**
 * Compiles a query once, then scores names against it.
 *
 * The catalog is ~6,800 rows and the list re-filters on every keystroke, so
 * anything done per row is done 6,800 times per character typed. Building the
 * word-boundary `RegExp`s is the expensive part: hoisting them out of the loop
 * measured 6.2-6.5x faster over the real catalog, which is the difference
 * between a search that keeps up with the keyboard and one that doesn't.
 *
 * Returns `null` for an empty query, which callers read as "no search applied"
 * rather than "nothing matched".
 *
 * `wholeWord` outranking `prefix` is the tier that earns its keep, and it was
 * added because the old order was visibly wrong: ranking any name *starting*
 * with the query above any name *containing* it as a word answered "row" with
 * Rowing, Rowing Boat Yoga Pose and Rowing Straight Back before it got to
 * Barbell Row, and answered "press" with Press Under before Bench Press. The
 * word someone types is nearly always the movement, and in this catalog the
 * movement is the *last* word of the name, behind its equipment and its grip.
 * Matching a whole word is the stronger signal; opening with the query is only
 * a tie-break on top of it, which is what `prefix` now is.
 *
 * The optional plural rides on the whole-word test so "Squats" and "Presses"
 * reach the same tier as "Squat" and "Press" rather than falling a tier for a
 * letter. It is the same conservative rule `exerciseMatchKey` uses on the
 * import side, and for the same reason: it only has to be consistent.
 */
export function createExerciseMatcher(query: string): ExerciseMatcher | null {
  const needle = query.toLowerCase().trim();
  if (!needle) return null;

  const escaped = escapeRegExp(needle);

  // "row" as its own word, tolerating the plural: Row, Rows, Presses.
  const wholeWord = new RegExp(`\\b${escaped}(e?s)?\\b`);

  // Matches at the start of any word, e.g. "curl" in "Bicep Curl (Barbell)".
  const wordStart = new RegExp(`\\b${escaped}`);

  // All query tokens present in any order: "barbell bench" → "Bench Press (Barbell)".
  const tokens = needle.split(/\s+/).filter(Boolean);
  const multiToken = tokens.length > 1 ? tokens : null;

  return (name) => {
    const haystack = name.toLowerCase();

    if (haystack === needle) return MATCH_SCORES.exact;

    /*
     * One `includes` gates both regexes, and it is the reason this stayed fast
     * after gaining a tier.
     *
     * Every tier from `substring` up requires the needle to be in the name
     * verbatim: a whole-word hit, a prefix and a word-start hit are all
     * substring hits with an extra condition. So a row that fails this test can
     * only reach `allTokens`, and the overwhelming majority of the catalog
     * fails it. `String.includes` is a fraction of the cost of a `RegExp.test`,
     * so the two regexes now run over the handful of rows that can actually
     * match rather than over all 6,800.
     */
    if (!haystack.includes(needle)) {
      return multiToken && multiToken.every((token) => haystack.includes(token))
        ? MATCH_SCORES.allTokens
        : 0;
    }

    if (wholeWord.test(haystack)) return MATCH_SCORES.wholeWord;
    if (haystack.startsWith(needle)) return MATCH_SCORES.prefix;
    if (wordStart.test(haystack)) return MATCH_SCORES.wordStart;

    return MATCH_SCORES.substring;
  };
}

/**
 * Ranked substring search over exercise names.
 *
 * Deliberately not fuzzy: gym-goers type prefixes ("bench", "rdl"), and fuzzy
 * matching mostly produces confusing far-off hits. Whole-word matches outrank
 * mid-word ones so "row" surfaces "Barbell Row" above "Narrow Grip …".
 *
 * Scoring one name against one query. To score many names against the *same*
 * query (which is what every list screen does) use `createExerciseMatcher`
 * and reuse the result; this compiles the query afresh on each call.
 */
export function scoreExerciseMatch(name: string, query: string): number {
  const match = createExerciseMatcher(query);
  return match ? match(name) : 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
