/**
 * Which of the palette's six category hues each body part is drawn in.
 *
 * `Palette['data']` holds six colours for telling one *category* from another,
 * and `BODY_PARTS` holds seven body parts, six of which are real muscle groups
 * and one of which is "other". The fit is exact and it is not a coincidence:
 * body part is the category this app charts more than any other, so it is what
 * the ramp was sized against.
 *
 * ## Why a fixed map rather than an index into whatever came back
 *
 * The obvious implementation is to colour the first bar `data[0]`, the second
 * `data[1]` and so on. It is wrong here, and visibly so, because every chart of
 * body parts in this app is **sorted by volume**. Under a positional scheme
 * chest takes the accent in a week you trained it hardest and the orange in a
 * week you did not, and the colour then encodes rank, which the bar's own
 * length already encodes, instead of encoding which muscle it is. Two screens
 * showing the same week would still agree; the same screen a week later would
 * not.
 *
 * With this map, back is `data[1]` on Home, on the workout summary and on the
 * stats screens, in every week, forever. That is the property that makes a
 * colour worth spending: it lets someone learn the key once instead of reading
 * the labels every time.
 *
 * ## The order
 *
 * `BODY_PARTS` order, straight down the ramp, which puts the accent on chest
 * rather than on anything chosen. There is no meaning to defend in the pairing
 * and inventing one ("legs are the heavy blue") would be a story rather than a
 * reason. What matters is only that it is fixed and that adjacent body parts,
 * which are the ones that appear next to each other in a sorted chart, get
 * adjacent ramp entries, which are the furthest apart in hue.
 *
 * `other` is the exception and takes no hue at all. It is not a muscle group,
 * it is the bucket for exercises that did not map to one, and giving the
 * leftovers a colour of their own puts them on equal footing with the six
 * things the chart is actually about. Callers draw it in a neutral: see
 * `bodyPartColor`.
 */

import { BODY_PARTS, type BodyPart } from '@lift/shared';

import type { Palette } from '@/theme';

/** Index into `Palette['data']`, or null for the one bucket that is not a muscle. */
export const BODY_PART_TONE: Record<BodyPart, 0 | 1 | 2 | 3 | 4 | 5 | null> = {
  chest: 0,
  back: 1,
  shoulders: 2,
  arms: 3,
  core: 4,
  legs: 5,
  other: null,
};

/**
 * The colour a body part is drawn in, with the neutral for `other` folded in.
 *
 * A function rather than a second map because the neutral is a palette lookup
 * and the six hues are a ramp lookup, and every caller would otherwise write
 * the same three-line conditional. Unknown strings fall through to the neutral
 * as well: `bodyPart` arrives from the database as text, and a row written by
 * an older build with a body part this one has dropped should render as an
 * uncategorised bar rather than crash on an undefined index.
 */
export function bodyPartColor(bodyPart: string, colors: Palette): string {
  const tone = BODY_PART_TONE[bodyPart as BodyPart];
  return tone === null || tone === undefined ? colors.textTertiary : colors.data[tone];
}

/**
 * Every body part in ramp order, for a legend.
 *
 * Derived from `BODY_PARTS` rather than from the map's own key order, because
 * an object's key order is a fact about how the literal above was typed and
 * this needs to be the same order the rest of the app lists body parts in.
 */
export const TONED_BODY_PARTS: readonly BodyPart[] = BODY_PARTS.filter(
  (part) => BODY_PART_TONE[part] !== null,
);
