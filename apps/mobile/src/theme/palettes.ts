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
 *    one palette here that does not meet this rule at all, because its accent
 *    is a red and no role fits underneath one; its note records what pays for
 *    the exception and what breaks if the rest of that palette is loosened.
 *
 * Every value was checked against the same bar the shipped two meet: AA on all
 * three grounds and on each role's own tint, a readable foreground on every
 * filled control including its pressed state, and 5:1 for the calendar's four
 * ramp stops. Changing one by eye is very likely to break one of those.
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
 * `danger` lands rosier than #E22134 because a red on this canvas has to clear
 * AA against its own tint: the same lift `darkPalette` documents under its own
 * #EC5A62, and it ends up in much the same place. The neutrals are Spotify's
 * real greys, except `surfaceMuted`, which the calendar ramp pulls lighter than
 * the #282828 Spotify uses for cards.
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

  warning: '#FF812B',
  warningSurface: 'rgba(255, 129, 43, 0.15)',

  danger: '#EB6975',
  dangerPressed: '#E8515E',
  dangerSurface: 'rgba(235, 105, 117, 0.15)',

  record: '#DDAC00',
  recordSurface: 'rgba(221, 172, 0, 0.15)',

  textOnAccent: '#101010',
  textOnSuccess: '#101010',
  textOnWarning: '#101010',
  textOnDanger: '#101010',

  overlay: 'rgba(0, 0, 0, 0.72)',
  skeleton: '#282828',
  mediaPlate: '#F2F2F2',
};

/**
 * Fitness, taken from Apple's app rather than from a published palette.
 *
 * The accent is the Move ring, #FF375F, at Apple's published value. That is the
 * whole theme: the colour that app draws the outer ring, the calorie figure and
 * the day's total in, on the black canvas it uses everywhere. `accentPressed`
 * is #FA114F, the other end of the same ring's gradient. `success` is the
 * Exercise ring, `danger` is systemRed nudged off the accent, and the greys are
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
 * What is done instead is to close the gap from the other side. Every role sits
 * as deep as it can while still passing and still reading as its own colour,
 * 0.31 to 0.46 against `darkPalette`'s 0.26 to 0.78, so the palette spans 0.21
 * of luminance in total rather than half the scale. Nothing in it shouts, which
 * is what lets the one saturated red be the loud thing by hue instead of by
 * brightness. The arrangement is only stable because it is *flat*. Lift any
 * role back towards its published value, particularly systemYellow at 0.694 or
 * the Exercise ring at 0.640, and that role becomes the accent in everything
 * but name.
 *
 * The neutrals are a step under Apple's. #1C1C1E is the card in that app and is
 * `surfaceElevated` here, because with it as `surface` the crimson measures
 * 4.14 on its own tint: below AA, on the label of every selected chip. On
 * #141416 it reads 4.51. The same move Nord makes with `nord0`, and for the
 * same reason: the alternative is bleaching the colour that the theme is for.
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

  // The Exercise ring at 0.418 rather than its published 0.640. See the note:
  // at 0.640 this is the brightest thing in the palette by a distance, and a
  // checked-off set row becomes the loudest element on the screen.
  success: '#73C115',
  successPressed: '#69B013',
  successSurface: 'rgba(115, 193, 21, 0.16)',

  warning: '#E78D00',
  warningSurface: 'rgba(231, 141, 0, 0.16)',

  danger: '#FF6553',
  // Effectively systemRed (#FF453A), which is where a pressed step from the
  // resting value lands anyway.
  dangerPressed: '#FF4733',
  dangerSurface: 'rgba(255, 101, 83, 0.16)',

  // systemYellow deepened from 0.694, the single largest cut in the palette.
  record: '#D6B200',
  recordSurface: 'rgba(214, 178, 0, 0.16)',

  textOnAccent: '#1A0008',
  textOnSuccess: '#0A1602',
  textOnWarning: '#1A1002',
  textOnDanger: '#2A0603',

  overlay: 'rgba(0, 0, 0, 0.72)',
  skeleton: '#1C1C1E',
  // systemGray6 light. Softer than pure white, for the reason `darkPalette`
  // gives under its own plate.
  mediaPlate: '#F2F2F7',
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

  record: '#765A00',
  recordSurface: 'rgba(118, 90, 0, 0.12)',

  textOnAccent: '#FFFFFF',
  textOnSuccess: '#FFFFFF',
  textOnWarning: '#FFFFFF',
  textOnDanger: '#FFFFFF',

  overlay: 'rgba(7, 54, 66, 0.42)',
  skeleton: '#E2DCC8',
  mediaPlate: '#FDF6E3',
};
