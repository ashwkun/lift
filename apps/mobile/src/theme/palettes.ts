/**
 * The named palettes, ported from six existing ones.
 *
 * `tokens.ts` holds the two palettes this app designed for itself and the
 * reasoning behind every value in them. These six are ports: the neutrals and
 * hues come from Nord, Gruvbox, Catppuccin Mocha, Spotify, Apple's Fitness app
 * and Solarized Light, and mostly only their *lightness* has been re-solved.
 * Read the note on `darkPalette` first. The constraints named there are the
 * ones every palette below had to meet, and the per-theme comments here only
 * record where a source colour could not be used as published.
 *
 * ## Why any of them needed changing
 *
 * Four of the six were designed for code editors, where colour marks syntax on
 * a single background and 4.5:1 is nobody's requirement. Four things follow,
 * and they account for nearly every deviation below. Spotify and Fitness are
 * the exceptions to most of it. See their own notes, which are about brand
 * colours that are not allowed to move rather than about editor palettes that
 * are:
 *
 * 1. **A mid-dark canvas raises every floor.** On the AMOLED palette a role
 *    only has to clear 4.5:1 against black. Against Nord's Polar Night it has
 *    to clear it against something ten times lighter, and a role that measured
 *    fine in an editor lands at 3.1. Each theme's neutrals are therefore
 *    deeper than the source's editor background. Nord's canvas here is well
 *    below `nord0`, because the alternative is bleaching every role pale
 *    enough to pass, which is what the first attempt at this file did.
 *
 * 2. **Tints cost contrast.** Every role prints on its own `*Surface` over a
 *    card, and on a dark theme that tint lifts the ground it sits on, which is
 *    the case that decides how deep a role may go. The dark ports still carry
 *    0.15 and Solarized 0.12, matching the shipped two: an earlier draft
 *    dropped them to 0.07 to buy headroom and the result was a tinted chip you
 *    could not see was tinted. If a role here needs more room, take it from the
 *    role, not from the tint.
 *
 * 3. **Editor palettes crowd their warm hues.** Gruvbox puts red, orange,
 *    yellow and green inside 55°, and `warning` beside `record` at that spacing
 *    is the collision `tokens.ts` fixed twice. Where depth does not already
 *    separate a pair, hues are rotated apart: at most 11° here, and always
 *    keeping red red-most and gold gold-most. Several roles needed no rotation
 *    at all and are their source colour exactly: Nord's `success`, Gruvbox's
 *    `success`, Catppuccin's `danger`.
 *
 * 4. **`accent` must outrank every other role in luminance.** Three of these
 *    palettes have a yellow brighter than their signature colour, so the accent
 *    is lifted and the roles come down to meet it. Neither side alone works:
 *    holding the roles put pushes the accent past 0.98, and holding the accent
 *    still crushes Catppuccin's pastels into vivid mid-tones. Fitness is the
 *    one palette *in this file* that does not meet this rule at all, because
 *    its accent is a red and no role fits underneath one; its note records what
 *    pays for the exception and what breaks if the rest of that palette is
 *    loosened. `darkPalette` has since taken the same crimson and is waived for
 *    the same check, and it is worth reading the two notes together: they reach
 *    opposite conclusions about what to do with the roles afterwards, and both
 *    are defensible.
 *
 * Every value was checked against the same bar the shipped two meet: AA on all
 * three grounds and on each role's own tint, a readable foreground on every
 * filled control including its pressed state, and 5:1 for the calendar's four
 * ramp stops. Changing one by eye is very likely to break one of those.
 *
 * That last paragraph was a claim before it was a check. `audit-palette.mjs`
 * read only `tokens.ts`, so these six were measured once, by hand, and then
 * never again: three values were sitting under the bar by the time anything
 * ran over them, two in Spotify and one in Solarized. It reads this file now
 * and audits every theme in `THEMES`. `node scripts/audit-palette.mjs`.
 */

import type { Palette } from './tokens';

/**
 * Nord: https://www.nordtheme.com (MIT).
 *
 * Neutrals are Polar Night taken two steps down; `nord0` (#2E3440) is Nord's
 * editor background and is used here as `surfacePressed` instead, because with
 * it as the canvas the Aurora colours cannot clear AA without going pastel.
 *
 * Aurora survives almost intact: `success` is `nord14` and `warning` is
 * `nord12`, both unchanged. `danger` is the one real casualty. `nord11`
 * (#BF616A) measures 3.10 on this card and has to lift, and a lifted red turns
 * rosy. `accent` is `nord8` brightened, which is what keeps the frost above the
 * Aurora yellow rather than a step below it.
 */
export const nordPalette: Palette = {
  background: '#161A22',
  surface: '#1D222C',
  surfaceElevated: '#212734',
  surfaceMuted: '#232A35',
  surfacePressed: '#3B4252',
  border: '#2C3341',
  borderStrong: '#4C566A',

  text: '#F6F8FA',
  textSecondary: '#BCBFC2',
  textTertiary: '#8D9094',

  accent: '#B8DAE3',
  accentPressed: '#9FCAD5',
  accentSurface: 'rgba(184, 218, 227, 0.15)',

  success: '#A3BE8C',
  successPressed: '#8FB074',
  successSurface: 'rgba(163, 190, 140, 0.15)',

  warning: '#D28B75',
  warningSurface: 'rgba(210, 139, 117, 0.15)',

  danger: '#CF8A95',
  dangerPressed: '#C87985',
  dangerSurface: 'rgba(207, 138, 149, 0.15)',

  record: '#E7C071',
  recordSurface: 'rgba(231, 192, 113, 0.15)',

  textOnAccent: '#0D1014',
  textOnSuccess: '#0D1014',
  textOnWarning: '#0D1014',
  textOnDanger: '#0D1014',

  overlay: 'rgba(11, 13, 17, 0.72)',
  skeleton: '#232936',
  mediaPlate: '#E5E9F0',

  // Aurora and Frost, which is very nearly the whole of Nord's colour: `nord8`
  // for the accent it already is, then `nord11` through `nord15` in hue order.
  // Nord puts its red and its orange 20° apart and this ramp inherits that,
  // which is the tightest pair in any of the eight and the reason the audit's
  // floor is 20° rather than 25°. Each is lifted to clear AA on a Polar Night
  // canvas, so they run paler than the published Aurora: the same tax every
  // role in this palette pays, recorded above.
  data: ['#B8DAE3', '#D899A0', '#DA9C89', '#D6A136', '#95B37A', '#C59EBE'],
};

/**
 * Gruvbox: https://github.com/morhetz/gruvbox (MIT).
 *
 * The warmest of the four, and the one whose hues had to move most. Gruvbox
 * packs red (6°), orange (27°), yellow (42°) and green (61°) into 55°, and this
 * app needs four of those five slots to be told apart at badge size. `success`
 * is `aqua` (#8EC07C) unchanged, which lands 43° off the accent: the same gap
 * `darkPalette` settled on for the same reason. `warning` and `danger` are
 * rotated a few degrees apart; `record` is `yellow` almost exactly.
 *
 * `accent` is `bright_green` lifted. Gruvbox's green is the closest thing in
 * any of these palettes to this app's own lime, which is why it gets the role.
 */
export const gruvboxPalette: Palette = {
  background: '#141617',
  surface: '#1D2021',
  surfaceElevated: '#252527',
  surfaceMuted: '#282726',
  surfacePressed: '#3C3836',
  border: '#343130',
  borderStrong: '#504945',

  text: '#FCF4D1',
  textSecondary: '#C1BCA2',
  textTertiary: '#918E7B',

  accent: '#D5D942',
  accentPressed: '#C3C732',
  accentSurface: 'rgba(213, 217, 66, 0.15)',

  success: '#8EC07C',
  successPressed: '#76B360',
  successSurface: 'rgba(142, 192, 124, 0.15)',

  warning: '#FE6827',
  warningSurface: 'rgba(254, 104, 39, 0.15)',

  danger: '#FC6671',
  dangerPressed: '#FB4855',
  dangerSurface: 'rgba(252, 102, 113, 0.15)',

  record: '#FAB621',
  recordSurface: 'rgba(250, 182, 33, 0.15)',

  textOnAccent: '#0E1010',
  textOnSuccess: '#0E1010',
  textOnWarning: '#0E1010',
  textOnDanger: '#0E1010',

  overlay: 'rgba(13, 15, 16, 0.72)',
  skeleton: '#32302F',
  mediaPlate: '#FBF1C7',

  // `bright_green` as the accent it already is, then red, orange, aqua, blue
  // and purple. Gruvbox's `yellow` is deliberately left out: it sits 18° off
  // the orange, which is under the floor, and dropping it is better than
  // rotating one of the two away from a hue the theme is known for.
  data: ['#D5D942', '#FC8482', '#FE8637', '#81B569', '#88AFA5', '#DA93AA'],
};

/**
 * Catppuccin Mocha: https://github.com/catppuccin/catppuccin (MIT).
 *
 * Mocha's roles are pastels sitting within 0.3 of each other in luminance, so
 * "one loud thing per view" has nothing to work with as published: `yellow`
 * outshines `mauve` by a wide margin. The accent is Mocha's mauve lifted and
 * the brightest roles come down, which is the smallest change that restores a
 * hierarchy while leaving them recognisably pastel.
 *
 * `danger` is Mocha's `red` (#F38BA8) exactly. It was already light enough,
 * being a pink rather than a true red, which is the one place Catppuccin's
 * palette suits this app better than its own.
 */
export const catppuccinPalette: Palette = {
  background: '#0C0C14',
  surface: '#15151F',
  surfaceElevated: '#1E1E2E',
  surfaceMuted: '#20202E',
  surfacePressed: '#313244',
  border: '#22222F',
  borderStrong: '#45475A',

  text: '#F1F4FB',
  textSecondary: '#B6B8C0',
  textTertiary: '#86888F',

  accent: '#E0CAFA',
  accentPressed: '#D3B5F8',
  accentSurface: 'rgba(224, 202, 250, 0.15)',

  success: '#8BD584',
  successPressed: '#66C85C',
  successSurface: 'rgba(139, 213, 132, 0.15)',

  warning: '#FAAB87',
  warningSurface: 'rgba(250, 171, 135, 0.15)',

  danger: '#F38BA8',
  dangerPressed: '#F17396',
  dangerSurface: 'rgba(243, 139, 168, 0.15)',

  record: '#EABE5B',
  recordSurface: 'rgba(234, 190, 91, 0.15)',

  textOnAccent: '#0F0F18',
  textOnSuccess: '#0F0F18',
  textOnWarning: '#0F0F18',
  textOnDanger: '#0F0F18',

  overlay: 'rgba(8, 8, 13, 0.72)',
  skeleton: '#28283C',
  mediaPlate: '#EFF1F5',

  // Mauve, red, peach, green, teal, blue: six of Mocha's fourteen, picked for
  // spacing rather than for being the famous ones. They needed less adjustment
  // than any other port here, because Catppuccin already solves for even
  // perceived weight across its whole set, which is exactly what a category
  // ramp wants and what an editor palette usually does not do.
  data: ['#E0CAFA', '#F390AC', '#F89456', '#5AC350', '#35C2AB', '#80AEFA'],
};

/**
 * Spotify, taken from its own interface rather than from a published palette.
 *
 * The odd one out here in two ways.
 *
 * **The accent does not move.** The other four are open-source themes whose
 * highlight colour has no exact value it must hold, so each is lifted to clear
 * its yellow. #1ED760 is a brand colour: lifted even 0.03 it becomes a mint
 * that is recognisably not Spotify, which is the entire point of the theme. So
 * it is pinned, the gap beneath it narrows from 0.08 to 0.05, and every other
 * role fits underneath. That works only because the canvas is nearly black:
 * on Nord's neutrals there is no room to do this.
 *
 * **Three of the roles are inventions.** Spotify's interface is green, black
 * and grey; the only other colour in it is the #E22134 it uses for errors,
 * which is `danger` here. There is no Spotify `success`, `warning` or `record`
 * to quote, so those are built to this app's rules instead: `success` sits 43°
 * off the accent, the same gap `darkPalette` settled on between its lime and
 * its check plate, and the warm pair is spaced as everywhere else.
 *
 * `danger` lands rosier than #E22134, and further from it than any other port
 * moves its red. Two floors stack here. A red on this canvas has to clear AA
 * against its own tint, which is the lift `darkPalette` documents under its own
 * #EC5A62; then it has to clear AA again on `surfaceMuted`, which in this one
 * palette is a mid grey rather than a near-black. The neutrals are Spotify's
 * real greys, except `surfaceMuted`, which the calendar ramp pulls lighter than
 * the #282828 Spotify uses for cards. That token is the reason both warm roles
 * below carry their own notes.
 *
 * Trademark, since this one is a company and not a community project: the name
 * and the colour are Spotify's. Fine for a private build; worth a rename before
 * this ships anywhere public.
 */
export const spotifyPalette: Palette = {
  background: '#121212',
  surface: '#1A1A1A',
  surfaceElevated: '#242424',
  surfaceMuted: '#3C3C3C',
  surfacePressed: '#404040',
  border: '#2E2E2E',
  borderStrong: '#535353',

  text: '#F7F7F7',
  textSecondary: '#CACACA',
  textTertiary: '#A6A6A6',

  accent: '#1ED760',
  accentPressed: '#1BC558',
  accentSurface: 'rgba(30, 215, 96, 0.15)',

  success: '#79C638',
  successPressed: '#6FB633',
  successSurface: 'rgba(121, 198, 56, 0.15)',

  /*
   * Lifted from #FF812B, which measured 4.43 on `surfaceMuted` and failed.
   *
   * The other repair is more obvious and is not available: take `surfaceMuted`
   * down to the #282828 Spotify uses for a card and every role on it gains most
   * of a stop. That token is where the calendar's ramp starts, and the ramp's
   * second stop is the tightest pairing in this palette: 5.06 against a 5:1
   * bar at #3C3C3C, 4.93 at #383838. The surface is pinned, so the roles move.
   * Hue is unchanged at 24°, which is what keeps it clear of `record`. Now 4.61.
   */
  warning: '#FF8735',
  warningSurface: 'rgba(255, 135, 53, 0.15)',

  /*
   * The same repair as `warning` and a much bigger step: #EB6975 measured 3.58
   * on `surfaceMuted`, which was the worst pairing anywhere in these eight
   * palettes. See `warning` for why the surface could not come down instead.
   *
   * What that costs is honesty about the colour: this is a light rose and not a
   * red. Spotify's own #E22134 was never a candidate here, at 2.36 on the same
   * fill, and the interface it is quoted from does not print it on grey either.
   * Now 4.64, and still the deepest role in the palette.
   */
  danger: '#F08B94',
  // Holds the same lightness step down that the old pair had, so the press is
  // the size it always was. `textOnDanger` reads 6.66 on it.
  dangerPressed: '#ED737E',
  dangerSurface: 'rgba(240, 139, 148, 0.15)',

  record: '#DDAC00',
  recordSurface: 'rgba(221, 172, 0, 0.15)',

  textOnAccent: '#101010',
  textOnSuccess: '#101010',
  textOnWarning: '#101010',
  textOnDanger: '#101010',

  overlay: 'rgba(0, 0, 0, 0.72)',
  skeleton: '#282828',
  mediaPlate: '#F2F2F2',

  /*
   * Five of these six are not Spotify's, and there is no way for them to be.
   *
   * Spotify ships one colour and a grey scale. That is the identity, and it is
   * why this palette works everywhere else in the file: a single green on near
   * black needs no companions. A category ramp does, so the green leads and the
   * other five are placed on hue alone, at Spotify's own saturation and at a
   * lightness that clears its unusually light `surfaceMuted` (#3C3C3C, the
   * lightest muted fill of any theme here, which is what holds this ramp paler
   * than the rest).
   *
   * Read them as this app's colours borrowed into a Spotify shell rather than
   * as anything Spotify publishes.
   */
  data: ['#1ED760', '#FFA366', '#D4B700', '#4FC8E0', '#9CBAF4', '#D7A6EF'],
};

/**
 * Fitness, taken from Apple's app rather than from a published palette.
 *
 * The accent is the Move ring, #FF375F, at Apple's published value. That is the
 * whole theme: the colour that app draws the outer ring, the calorie figure and
 * the day's total in, on the black canvas it uses everywhere. `accentPressed`
 * is #FA114F, the other end of the same ring's gradient, and the greys are
 * iOS's own.
 *
 * **This is the one palette here where `accent` does not outrank every other
 * role in luminance, and it is deliberate.** See point 4 at the top of this
 * file for what the rule buys everywhere else. The crimson sits at 0.248, and
 * no role can be placed under it: a role has to clear 4.5 against the canvas,
 * the card, a muted fill *and* its own tint, and the tint is the binding one at
 * roughly 0.25 even after the neutrals below are taken as deep as they go.
 * Something had to give, and lifting the crimson until it cleared the others
 * was the alternative. It does not survive that: by 0.40 it is a rose, by 0.50
 * a salmon, and a Fitness theme whose Move colour is salmon has nothing left to
 * be.
 *
 * ## What this palette used to do about that, and why it stopped
 *
 * It closed the gap from the other side. Every role was taken as deep as it
 * could go while still passing, 0.31 to 0.46, so the palette spanned 0.21 of
 * luminance in total and nothing in it shouted. The argument was that a flat
 * set lets the one saturated red be the loud thing by hue instead of by
 * brightness, and as an argument about *this app's* roles it was sound.
 *
 * It was also the wrong reading of the source. Open the app this theme is named
 * after and the Exercise ring is a full-brightness lime, the step count is
 * printed in a bright violet and the distance under it in a bright cyan, all on
 * the same black canvas as the Move ring, all at once. The multiplicity *is*
 * the design. Flattening every role to protect the accent produced something
 * that reads as one colour on grey, which is a defensible palette and is not
 * this one.
 *
 * So the roles are back at or beside their published values: the Exercise ring
 * at 0.656 rather than the 0.418 it was cut to, systemYellow at 0.685 rather
 * than 0.461, systemOrange whole. The palette now spans 0.25 to 0.69.
 *
 * What pays for it is honesty about the ranking rather than a number. The
 * accent is the *quietest* role here by luminance and there is no arrangement
 * in which it is not, so it cannot lead on brightness and does not try to. It
 * leads on hue, being the only red-pink in the palette, and on rationing: the
 * app budgets roughly one accent element per view. That is a weaker guarantee
 * than the other seven themes have and the waiver in `audit-palette.mjs` is
 * where it is written down.
 *
 * The neutrals are a step under Apple's. #1C1C1E is the card in that app and is
 * `surfaceElevated` here, because with it as `surface` the crimson measures
 * 4.14 on its own tint: below AA, on the label of every selected chip. On
 * #141416 it reads 4.51. The same move Nord makes with `nord0`, and for the
 * same reason: the alternative is bleaching the colour that the theme is for.
 *
 * This is also the *only* palette in the app that can hold a true Move crimson,
 * and the reason is entirely the depth of those neutrals. `darkPalette` spent a
 * release trying to take the same accent and had to give it up: its card ramp
 * is two rungs lighter, the crimson measured 4.08 on its `surfaceMuted`, and
 * lifting it to pass turned it pink. See the note under `data` there.
 *
 * `text` is pure white, which no other dark palette here uses. Two reasons, and
 * the second is the one that decides it. iOS's label colour is #FFFFFF, so the
 * theme is quoting rather than departing; and the calendar's third ramp stop is
 * a mid crimson at 0.157, which is the dead zone between a light foreground and
 * a dark one. It measures 4.54 under an off-white and 5.07 under white, against
 * a bar of 5. A red accent is what puts a stop there at all: a bright accent
 * ramps past that band in one step, and this one climbs through it.
 *
 * Two things this palette is honestly worse at, both consequences of the same
 * choice:
 *
 * 1. The calendar's lightest trained day reads 1.87 against its card, where the
 *    shipped dark palette manages 3.57. It is the light palette's problem
 *    arriving on a dark theme, and it has the light palette's backstop: the day
 *    number takes a different colour on a trained square, and the square is
 *    labelled for a screen reader. See `month-grid.tsx`.
 * 2. `danger` cannot get far from a red accent. It holds 18° and 0.06 of
 *    luminance off the crimson, which is what the floors allow, and its pressed
 *    step lands on systemRed. What actually separates a destructive control
 *    here is that it is not filled: see `danger` in `ui/button.tsx`.
 *
 * Trademark, as with Spotify: the name and these colours are Apple's. Fine for
 * a private build; worth a rename before this ships anywhere public.
 */
export const fitnessPalette: Palette = {
  background: '#000000',
  // A step under systemGray6, which is `surfaceElevated` below. See the note.
  surface: '#141416',
  surfaceElevated: '#1C1C1E',
  surfaceMuted: '#202022',
  surfacePressed: '#2C2C2E',
  border: '#242426',
  borderStrong: '#3A3A3C',

  // Apple greys, and the canvas is dark enough that none of them needed
  // lifting. The middle one is systemGray2 rather than iOS's own secondary
  // label, which is #EBEBF5 at 60% and composites over black to #8D8D93: the
  // same colour as systemGray below it, to within one step per channel. Quoting
  // both would leave this palette with two tiers where it needs three.
  text: '#FFFFFF',
  textSecondary: '#AEAEB2',
  textTertiary: '#8E8E93',

  accent: '#FF375F',
  accentPressed: '#FA114F',
  // 0.15 rather than 0.16, which is the last of the headroom the accent needs
  // to clear its own tint. At 0.16 it reads 4.42.
  accentSurface: 'rgba(255, 55, 95, 0.15)',

  // The Exercise ring, published, at 0.656. It was cut to #73C115 and 0.418 to
  // keep it under the Move ring; see the note for why that cut is gone. This
  // is now the brightest role bar `record`, which is what it is in the app
  // being quoted, where a closed Exercise ring is meant to be seen from across
  // a room.
  success: '#A2E82C',
  // Darker, and a whole step rather than the shallow one the crimson needs: the
  // foreground here is a near-black on a very bright fill, so there is a great
  // deal of room to press into. 9.94 on the held state.
  successPressed: '#8FD024',
  successSurface: 'rgba(162, 232, 44, 0.16)',

  // systemOrange, whole. 36°, which is the closest any role gets to `record` at
  // 48°: 12°, over the 10° floor, and the pair is also separated by a third of
  // a stop of luminance, which the two of them can afford now that neither is
  // being held down.
  warning: '#FF9F0A',
  warningSurface: 'rgba(255, 159, 10, 0.16)',

  danger: '#FF6553',
  // Effectively systemRed (#FF453A), which is where a pressed step from the
  // resting value lands anyway.
  dangerPressed: '#FF4733',
  dangerSurface: 'rgba(255, 101, 83, 0.16)',

  // systemYellow, published, at 0.685. This was #D6B200 and 0.461, described in
  // the old note as "the single largest cut in the palette"; it is now the
  // largest restoration.
  record: '#FFD426',
  recordSurface: 'rgba(255, 212, 38, 0.16)',

  textOnAccent: '#1A0008',
  textOnSuccess: '#0A1602',
  textOnWarning: '#1A1002',
  textOnDanger: '#2A0603',

  overlay: 'rgba(0, 0, 0, 0.72)',
  skeleton: '#1C1C1E',
  // systemGray6 light. Softer than pure white, for the reason `darkPalette`
  // gives under its own plate.
  mediaPlate: '#F2F2F7',

  /*
   * Apple's system colours, published, and the only ramp in the file that is a
   * straight quotation: systemPink (the Move ring), systemOrange, the Exercise
   * ring, systemGreen, systemCyan and systemPurple.
   *
   * This is the palette the category ramp was designed for and the one where it
   * costs nothing to be literal. Everywhere else the six had to be re-solved,
   * either because the source project crowded its own hues or because a
   * published set spans more luminance than one theme can absorb. Here the
   * source *is* a six-colour system built for one black canvas, so five of the
   * six are exact.
   *
   * The exception is `data[5]`. systemPurple (#BF5AF2) sits at 0.248, the same
   * luminance as the Move ring, and measures 4.33 on its own 0.16 tint: below
   * AA on the glyph of every category row it would draw. Two points of HSL
   * lightness fixes it at 4.71 and nothing about the colour changes.
   */
  data: ['#FF375F', '#FF9F0A', '#A2E82C', '#30D158', '#64D2FF', '#C567F4'],
};

/**
 * Solarized Light: https://ethanschoonover.com/solarized (MIT).
 *
 * The only light theme here, and the only one that could not be used at its
 * published depths at all. Solarized's body text is `base00` (#657B83), which
 * measures **4.05** on `base3` (its own background) and its accents sit
 * alongside it. That is a known and deliberate property of the palette; it is
 * also below AA, so every foreground here is deepened.
 *
 * What is kept is the part that makes Solarized recognisable: the two warm
 * paper tones (`base3`, `base2`) as surface and canvas, and the accent hues.
 * `text` goes well past `base02` to near-black, which the calendar needs: see
 * `readableOn` in `color.ts` for why a light theme's darkest foreground has to
 * be genuinely dark rather than merely dark enough to read.
 */
export const solarizedPalette: Palette = {
  background: '#EEE8D5',
  surface: '#FDF6E3',
  surfaceElevated: '#FDF6E3',
  surfaceMuted: '#DED7BA',
  surfacePressed: '#DCD5BE',
  border: '#E2DCC8',
  borderStrong: '#BFB8A0',

  text: '#031519',
  textSecondary: '#313E3E',
  textTertiary: '#56605C',

  accent: '#185783',
  accentPressed: '#154B72',
  accentSurface: 'rgba(24, 87, 131, 0.12)',

  success: '#576400',
  successPressed: '#4B5700',
  successSurface: 'rgba(87, 100, 0, 0.12)',

  warning: '#A23C12',
  warningSurface: 'rgba(162, 60, 18, 0.12)',

  danger: '#B31E2A',
  dangerPressed: '#9C1A24',
  dangerSurface: 'rgba(179, 30, 42, 0.12)',

  /*
   * One step deeper than #765A00, which measured 4.4962 on `surfaceMuted`:
   * that rounds to the 4.50 it needs and is not it.
   *
   * The gold is the only role on the wrong side of the line because it was the
   * lightest of the five, and on a light theme lightest means least contrast.
   * All five now sit between 4.50 and 4.64 on this fill, packed against the bar
   * because that is what this palette is: Solarized's published accents measure
   * below AA on Solarized's own paper (`yellow` reads 2.22 here), so each of
   * them is already as deep as it can go before it stops being the colour it
   * quotes.
   *
   * Raising `surfaceMuted` would fix it too. Rejected: that token is where the
   * calendar's ramp starts, so it moves four stops to repair one role.
   */
  record: '#745800',
  recordSurface: 'rgba(116, 88, 0, 0.12)',

  textOnAccent: '#FFFFFF',
  textOnSuccess: '#FFFFFF',
  textOnWarning: '#FFFFFF',
  textOnDanger: '#FFFFFF',

  overlay: 'rgba(7, 54, 66, 0.42)',
  skeleton: '#E2DCC8',
  mediaPlate: '#FDF6E3',

  // Solarized's accent set, which is the one part of that palette designed to
  // be six-plus distinguishable colours on one background: blue as the accent
  // it already is, then red, yellow, green, cyan and magenta. Orange and violet
  // are dropped as too near red and blue respectively. These are close to
  // published, because Solarized solved them against a light ground to begin
  // with, which is the one thing the four editor ports above did not.
  data: ['#185783', '#A01C1A', '#694E00', '#4B5700', '#185B56', '#94265B'],
};
