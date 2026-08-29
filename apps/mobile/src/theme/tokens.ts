/**
 * Design tokens.
 *
 * Every palette defines the *same* key set so components can read
 * `colors.surface` without ever branching on scheme. Semantic names
 * (`surface`, `textSecondary`) rather than literal ones (`gray800`) because the
 * light palettes invert lightness. A name like `gray800` would be a lie in
 * half the themes.
 *
 * The two palettes below are this app's own and carry the reasoning for every
 * value in them; the six ported ones live in `palettes.ts` and were solved
 * against the constraints recorded here. Anything written below about what a
 * token has to clear applies to those six as well, so a change here is a
 * change to eight palettes.
 *
 * Not every token is a colour. `data` is a list of six, and it is the one part
 * of the palette that encodes *categories* rather than status; see its own note
 * on the interface. `PaletteColor` below is the subset that is a single colour,
 * and is what anything taking a token by name should accept.
 */

import { Platform, StyleSheet, type TextStyle } from 'react-native';

/**
 * Which of the platform's two renderings a palette belongs to.
 *
 * Not the same thing as which theme is selected. There are seven of those and
 * only ever two of these. It drives the handful of decisions that are about
 * light-versus-dark rather than about colour: the status bar's glyphs, whether
 * `elevation` draws a shadow at all, and the browser's `color-scheme`, which is
 * what themes its scrollbars and form controls.
 *
 * Declared here rather than beside the theme context because `palettes.ts`
 * needs it and the context imports from both.
 */
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  /** App canvas, behind everything. Pure black in dark mode: see `darkPalette`. */
  background: string;
  /** Cards, list rows, sheets. */
  surface: string;
  /** Raised surfaces: modals, menus, sheets that sit above a card. */
  surfaceElevated: string;
  /** Subtle fills: input backgrounds, chips, table stripes. */
  surfaceMuted: string;
  /** Pressed state for any tappable surface (rows, cards, secondary buttons). */
  surfacePressed: string;
  /** Hairline dividers. */
  border: string;
  /** Visible outlines: focused inputs, selected chips. */
  borderStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;

  accent: string;
  accentPressed: string;
  /** Tinted background for accent chips and selected rows. */
  accentSurface: string;

  success: string;
  successPressed: string;
  successSurface: string;

  warning: string;
  warningSurface: string;

  danger: string;
  dangerPressed: string;
  dangerSurface: string;

  /** Personal-record gold. */
  record: string;
  recordSurface: string;

  /**
   * Foregrounds for text and glyphs sitting on a filled role colour.
   *
   * These are not all white. On the dark palette `accent`, `success` and
   * `record` are bright enough that white on top lands at or below 2:1 contrast:
   * legible only if you already know what it says. Each role names its own
   * foreground so a filled button can never pick the wrong one.
   */
  textOnAccent: string;
  textOnSuccess: string;
  textOnWarning: string;
  textOnDanger: string;

  /** Scrim behind modals. */
  overlay: string;
  /** Skeleton/shimmer base. */
  skeleton: string;

  /**
   * Backing plate for exercise illustrations.
   *
   * The catalog's artwork is line drawings on a transparent background, and
   * roughly a third of their ink is near-black. Dropped straight onto the
   * AMOLED canvas that portion of every figure simply disappears. This stays
   * light in both themes so the plate reads as a deliberate frame around the
   * artwork rather than a dark-mode patch.
   */
  mediaPlate: string;

  /**
   * Six hues for encoding *categories*, and the one part of the palette that is
   * not about status.
   *
   * Every token above answers "what kind of thing is this": an accent marks the
   * subject, `success` says done, `danger` says this destroys something. None of
   * them can say "this series is steps and that one is distance", because a
   * chart's third series is not a third kind of importance. Reaching for role
   * colours to fill that gap is how a palette ends up with a green bar that
   * does not mean success, and it is why every chart in this app used to draw
   * every series in the accent and rely on a legend to disambiguate.
   *
   * The order is fixed and meaningful. `data[0]` **is** the palette's `accent`,
   * repeated rather than approximated, so a single-series chart drawn from this
   * ramp is identical to one drawn from the accent, and a chart that grows a
   * second series keeps its first one where it was.
   *
   * Every entry clears AA on `background`, `surface` and `surfaceMuted`, which
   * is a stricter bar than a chart mark needs. It is set there deliberately:
   * the point of the ramp is that a figure can be *printed* in its series'
   * colour, the way Apple's Fitness app prints a step count in the same purple
   * as the bars under it, and a colour that only works as a 4px bar cannot do
   * that. `audit-palette.mjs` measures all six against all three surfaces.
   *
   * ## Two kinds of ramp, and a theme picks one
   *
   * **Polychrome**, which is six hues at least 20° apart, running warm to cool
   * after the accent. Six themes do this, because their source projects are
   * themselves six-or-more-colour systems and a chart drawn in them is readable
   * without a legend. `fitness` is the clearest case: its ramp is Apple's own
   * system colours, five of six exact.
   *
   * **Monochrome**, which is the accent and five steps of the same hue. `light`
   * and `dark` do this, because one saturated colour on a plain canvas is the
   * whole of what those two themes are, and a violet in the dark palette would
   * be a violet in a theme that has never had one. It is the worse ramp at the
   * job the ramp exists for, and the note on `darkPalette` says so in those
   * words along with the arithmetic that bounds it.
   *
   * The audit accepts either: every pair of entries must be 20° apart in hue
   * **or** 1.15:1 apart in contrast, and it prints which of the two carried
   * each pair, so a polychrome ramp that has quietly collapsed shows up in the
   * output rather than merely passing.
   */
  data: readonly [string, string, string, string, string, string];
}

/**
 * The palette keys that name a single colour.
 *
 * `data` is a list, so `keyof Palette` stopped being the same thing as "a token
 * a component may hand to a `color` prop" the moment it was added. Anything
 * that takes a token by *name* wants this instead. Derived rather than written
 * out, so a colour added tomorrow is included tomorrow and a second ramp is
 * excluded tomorrow.
 */
export type PaletteColor = {
  [K in keyof Palette]: Palette[K] extends string ? K : never;
}[keyof Palette];

/**
 * AMOLED dark palette, with Nuvio's card ramp above it.
 *
 * `background` is true `#000000` so the panel leaves those pixels physically
 * unlit: deeper blacks, and less battery burnt on a screen that is mostly
 * background. That part is unchanged. What sits on top of it is now Nuvio's:
 * `#1A1A1A` for a card and `#222222` for a modal, its `backgroundElevated` and
 * `backgroundCard` taken directly, with the two rungs this app needs and that
 * one does not have continued at the same `+08` step (`#2A2A2A`, `#323232`).
 *
 * So the ramp is `#000` → `1A` → `22` → `2A` → `32` where it used to be `#000`
 * → `0C` → `16` → `1E` → `26`. It still steps evenly, which is what keeps a
 * card, a modal and a pressed row visibly distinct instead of three guesses at
 * "dark grey", but **it now starts much higher**: a card is 1A against 0C, so
 * the jump off the black canvas is a real edge rather than a suggestion, and
 * every role printed on one has less room than it did. See the note on
 * `surfaceMuted` for the one that pays for it.
 *
 * One thing deliberately *not* ported. Nuvio's card (`#222222`) is lighter than
 * its sheet (`#1A1A1A`); here the order is the other way round, because in this
 * app `surface` is the card and `surfaceElevated` is what sits above one.
 * Flipping to match would invert the ramp and make a modal recede behind the
 * row that opened it.
 *
 * Text is Nuvio's three tiers (`#F5F7F8` / `#B8BEC5` / `#969CA3`), which are a
 * touch cooler and, in the lower two, materially lighter than what they
 * replace. That is what pays for the lifted surfaces. `text` is still not pure
 * white: at 21:1 on black, white text blooms on OLED and reads as if it is
 * vibrating. This still clears WCAG AAA.
 */
export const darkPalette: Palette = {
  background: '#000000',
  surface: '#1A1A1A',
  surfaceElevated: '#222222',
  /*
   * The binding surface in the palette, and the one the lift costs most.
   *
   * Every role has to clear AA printed on this, and it is the lightest fill any
   * of them lands on: input backgrounds, chips, table stripes. At `#1E1E24` the
   * roles had roughly a third of a stop more room than they do at `#2A2A2A`.
   * They still pass — `scripts/audit-palette.mjs` is the check, and it is the
   * first thing to run if any role colour moves — but the margin is thinner, so
   * a role that wants to go *deeper* from here probably cannot.
   */
  surfaceMuted: '#2A2A2A',
  surfacePressed: '#323232',
  /*
   * Nuvio's `borderDefault`, and it is nearly the same value as the modal it
   * draws on (1.07:1 against `surfaceElevated`). That is Nuvio's look rather
   * than an oversight — its own hairlines sit at the same near-invisible
   * distance from its cards. Where a divider actually has to be *seen* rather
   * than felt, that is what `borderStrong` is for.
   */
  border: '#252A2A',
  borderStrong: '#3A4040',

  text: '#F5F7F8',
  textSecondary: '#B8BEC5',
  // Nuvio's `textMuted`, and lighter than the #84848F it replaces, which is the
  // only reason this tier survives the lifted surfaces. It carries the
  // previous-set column and the unchecked check glyph, and it is printed on
  // `surfaceMuted` as often as on the canvas.
  textTertiary: '#969CA3',

  /*
   * Electric lime: the one saturated colour in the app, and the reason the
   * dark canvas reads as deliberate rather than absent. It sits at ~78%
   * relative luminance, so on black it is the brightest thing on screen by a
   * wide margin: one accent element per view is usually the correct number.
   *
   * That last sentence only holds if nothing else competes, and for a long time
   * everything did. The four role colours below ran at 62–100% saturation and
   * 51–68% lightness (five near-maximum colours, none subordinate) so the
   * lime was not read as *the* accent, it was read as one of the loud ones.
   * They are now placed underneath it on purpose. The invariant, worth checking
   * whenever one of them moves: **`accent` outranks every other role in
   * relative luminance.** Currently 0.783 against record 0.593, success 0.466,
   * warning 0.377, danger 0.260.
   */
  accent: '#D2F34B',
  accentPressed: '#B6D634',
  // 0.15 rather than the 0.16 the other roles use. Lime is bright enough that
  // an equal alpha makes the tint read as a filled surface instead of a hint.
  accentSurface: 'rgba(210, 243, 75, 0.15)',

  /*
   * Yellow-green rather than emerald, and that is the fix for a mismatch you
   * could see on every completed set.
   *
   * A checked-off row tints `accentSurface` (lime, hue 72°) and the check
   * plate inside it fills `success`, which was #34D07A at hue 147°. Two greens
   * 75° apart, touching, on the one interaction this app exists to perform.
   * That gap is the worst of both worlds: too close to read as a deliberate
   * contrast, too far to read as one family, so the row read as two colours
   * that had been chosen by different people.
   *
   * 115° sits 43° off the lime. Far enough that "done" still reads as green
   * and never as a second accent, close enough that the plate and the row it
   * sits in belong to the same family. Saturation comes down to 53% against the
   * lime's 87% for the reason in the block above: this is a confirmation, not
   * the subject of the screen. 10.32 on the canvas, 9.59 on `surface`, 8.15 on
   * `surfaceMuted`. The plate's own resting fill.
   */
  success: '#63CC5A',
  successPressed: '#4FAF48',
  successSurface: 'rgba(99, 204, 90, 0.16)',

  /*
   * Burnt orange, not amber, and this is the same collision the light palette
   * fixed and documented under `record`, which the dark palette never got.
   *
   * `warning` was #FBBF24 at hue 43° and `record` was #FFC53D at hue 42°. One
   * degree apart: a PR badge and a validation warning were, on the primary
   * palette, the same colour with nothing but their glyph to tell them apart.
   * Light had already separated them by hue (26° against 50°) precisely because
   * the PR marker is often a 13px trophy where a lightness step does not
   * register. Dark now separates them the same way, 30° against 43°.
   */
  warning: '#E8913C',
  warningSurface: 'rgba(232, 145, 60, 0.16)',

  /*
   * Pulled off pure red, and its foreground is no longer white.
   *
   * #FF5A5A was hue 0° at 100% saturation and 68% lightness: the only role in
   * the palette sitting on a primary, and the lowest-contrast one at 6.86. It
   * also blooms on OLED for the same reason pure white text does, which is why
   * `text` is #F5F5F7 rather than #FFF.
   *
   * The white foreground was the real defect. `textOnDanger` measured **3.06**
   * on it: below AA, on the label of every filled Discard and Delete button in
   * the app, in a palette whose whole premise is that a role names a foreground
   * so a filled control cannot pick an unreadable one. It cannot be fixed by
   * darkening the red either: white only reaches 4.5 around #B3282E, which is a
   * muddy brick on a true-black canvas.
   *
   * So the foreground goes dark like every other role here, which reads well
   * clear of AA and lets the red stay bright enough to belong to this palette.
   * Destructive *buttons* no longer fill at all (see `danger` in
   * `ui/button.tsx`) so the fill that remains is the swipe-to-delete plate and
   * the filled header pill, where an unmistakable red is the point.
   *
   * **It was #EC5A62 and had to lift when the surfaces did.** This is the one
   * role the Nuvio card ramp broke. At the old depth it measured 4.24 printed
   * on `surfaceMuted` and 4.21 on its own tint over a card: both below AA, both
   * caused purely by the ground moving up under it, and it was the only role
   * with too little headroom to absorb that. Every other one still passes
   * untouched.
   *
   * The lift is four points of HSL lightness, 64% to 68%, at an unchanged
   * 357° and 79% saturation. That is the smallest move that clears both — 4.84
   * and 4.68 — and it deliberately stops there, because the note on the Fitness
   * palette is right that a red climbing towards 0.40 luminance stops being a
   * red and becomes a rose. This sits at 0.300, against a resting 0.260, and it
   * is still the lowest-luminance role in the palette by a clear margin, which
   * is what keeps `accent` reading as the accent.
   */
  danger: '#EE6D74',
  /*
   * A shallower step down than the other roles take, and it is the dark
   * foreground that sets the floor.
   *
   * A pressed fill has to be darker than its resting one: a press that
   * brightens a control reads as a release, but `textOnDanger` is now dark, so
   * every step down also costs label contrast. #D13F48 was the natural depth
   * and took the label to 4.02, which is the same AA failure this palette just
   * fixed, moved from the resting state to the held one.
   *
   * It is now exactly the red that used to be the resting value. When `danger`
   * lifted a step, the step it vacated was already the right distance below:
   * four points of lightness, a visible press, and a label that clears AA on it
   * by more than it did on the old pressed value.
   */
  dangerPressed: '#EC5A62',
  dangerSurface: 'rgba(238, 109, 116, 0.16)',

  /** Personal-record gold. Held at 43°; see `warning` for why it moved away. */
  record: '#F5C445',
  recordSurface: 'rgba(245, 196, 69, 0.16)',

  textOnAccent: '#12180A',
  textOnSuccess: '#06170A',
  textOnWarning: '#1A1002',
  // Dark, not white. See the note on `danger`: white measured 3.06 here.
  textOnDanger: '#2A0507',

  overlay: 'rgba(0, 0, 0, 0.72)',
  // Tracks `surfaceElevated`, as it always has: a skeleton is a card that has
  // not arrived yet, so it reads as one step above the card it will become.
  skeleton: '#222222',
  // Softer than pure white: a full-white plate against a true-black canvas is
  // a glare source at 6am, and the artwork's dark ink stays legible well below
  // that brightness.
  mediaPlate: '#E8E8EC',

  /*
   * The category ramp, and this palette's is **one hue**.
   *
   * Six colours is what the ramp is *for*: `data` exists so a chart can say
   * which series is which without a legend, and five of the eight themes spend
   * it on five or six different hues. This one does not, and the reason is that
   * the lime is the entire identity of this theme. A theme whose premise is one
   * saturated colour on a black canvas cannot also be the theme with a violet
   * and a cyan in it; that is what `fitness` is, and it is a different theme.
   *
   * So this is the accent and five steps beneath it, at 72° throughout, losing
   * saturation as it darkens so the deep end fades toward the neutral rather
   * than staying an insistent olive. `data[0]` is `accent` exactly, as it is
   * everywhere.
   *
   * ## What that costs, stated plainly
   *
   * Adjacent steps sit 1.19:1 apart. That is a real separation and it is a weak
   * one: six lime bars in a row are told apart by their order and their labels
   * far more than by their colour, where six hues would be readable at a
   * glance. A single-hue ramp is simply worse at the job the ramp exists to do,
   * and this palette accepts that in exchange for looking like itself.
   *
   * The 1.19 is not a number that can be improved by choosing better values,
   * which is worth knowing before someone tries. The scale is bounded above by
   * the accent (11.39 on `surfaceMuted`) and below by AA on that same surface
   * (4.5), so there is a factor of 2.4 of contrast to divide among five gaps
   * and no arrangement of six colours inside it does better. Widening it means
   * either a second hue or letting the deep end fail AA.
   *
   * `audit-palette.mjs` accepts a ramp separated by hue *or* by luminance for
   * this reason, and prints which of the two carried each pair.
   */
  data: ['#D2F34B', '#CDD99B', '#B9CA72', '#9CBF0D', '#91AE1D', '#899D3B'],
};

export const lightPalette: Palette = {
  background: '#F4F4F6',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EFEFF2',
  surfacePressed: '#E4E4EA',
  border: '#E2E2E8',
  borderStrong: '#C9C9D2',

  text: '#111114',
  // 6.20 on `background`, 6.82 on `surface`. The previous #6B6B75 measured 4.80:
  // nominally a pass, but it sat so close to the AA line that the tier below
  // it had nowhere left to go.
  textSecondary: '#5A5A64',
  // 4.09 on `background`, 4.49 on `surface`, and that is the honest ceiling: a
  // third tier dark enough to reach 4.5 on `background` lands within a step of
  // `textSecondary` and collapses the neutral ramp from three tiers into two.
  // The previous #95959F measured 2.70. Because this token cannot be made to
  // pass, it is only ever used for text that repeats something already stated
  // in a higher tier (units beside a number, placeholders, row hints) and
  // never for the only copy of a fact.
  textTertiary: '#767681',

  // The same yellow-green hue as the dark palette, dropped to a depth where it
  // still works as *text*. `accent` is read as a foreground far more often than
  // as a fill (ghost buttons, active tabs, links), and the dark palette's lime
  // on white is roughly 1.3:1. Invisible. This clears AA on both `surface` and
  // `background`; the lime itself survives in `accentSurface`.
  accent: '#54700A',
  accentPressed: '#3F5406',
  accentSurface: 'rgba(163, 209, 30, 0.22)',

  /*
   * Hue 111°, tracking the dark palette's move off emerald: see `success`
   * there for why the app no longer has two unrelated greens.
   *
   * Depth is set by a case the dark palette does not have. Every tinted control
   * prints its role colour on that role's own `*Surface`, and on white a tint
   * barely darkens the ground, so the text has to carry nearly the full
   * contrast alone: #2F7A20, which is the direct lightness match for the dark
   * value, measured 4.28 on its own tint and failed. This reads 5.94 on
   * `background`, 6.52 on `surface`, and 5.14 on `successSurface` over a card.
   *
   * `successPressed` has to go *down* from here rather than up: a pressed
   * value lighter than the resting one makes a press brighten the button.
   */
  success: '#2A6B1E',
  successPressed: '#1E4E14',
  successSurface: 'rgba(42, 107, 30, 0.10)',

  // 5.40 on `background`, 5.93 on `surface`; #D97706 measured 2.90. Burnt
  // orange rather than amber so that it and `record` cannot be confused: see
  // `record` below. The tint drops from 0.14 to 0.10 for the reason given under
  // `success`: at 0.14 the warning label on its own tint measured 4.42.
  warning: '#A34A07',
  warningSurface: 'rgba(163, 74, 7, 0.10)',

  // 357°, holding the hue the dark palette moved to, and deeper than the
  // #DC2626 it replaces: that measured 4.40 on `background` and 4.30 on its own
  // tint, which is the surface the destructive button now uses. This reads 5.96
  // and 5.08. See `danger` on the dark palette for why filled red went away.
  danger: '#B3242C',
  dangerPressed: '#8E1B22',
  dangerSurface: 'rgba(179, 36, 44, 0.10)',

  // Light mode used to give `record` and `warning` the same #D97706, so a PR
  // badge and a validation warning were the same colour on the same card with
  // nothing but their glyph to tell them apart. `record` keeps the gold and
  // `warning` moves to burnt orange; the two are separated by hue (50° against
  // 26°) rather than depth alone, because the PR marker is often a 13px trophy
  // where a lightness step would not register. 5.99 on `background`, 6.58 on
  // `surface`, and 4.92 on its own `recordSurface` tint over a card. The badge
  // is the case that has to pass, and a tint costs roughly 0.8 of whatever the
  // colour measures on the bare surface.
  record: '#6E5C00',
  recordSurface: 'rgba(110, 92, 0, 0.10)',

  textOnAccent: '#FFFFFF',
  textOnSuccess: '#FFFFFF',
  textOnWarning: '#FFFFFF',
  textOnDanger: '#FFFFFF',

  overlay: 'rgba(0, 0, 0, 0.4)',
  skeleton: '#E7E7EC',
  mediaPlate: '#FFFFFF',

  /*
   * The dark palette's single-hue ramp, at 76° and running the other way.
   *
   * Same decision and same trade: see `data` on `darkPalette`, which argues it
   * out. What differs is only the direction. On a dark palette the accent is
   * the brightest thing available and the scale descends from it; here the
   * accent is already a deepened text colour sitting at 4.95 on `surfaceMuted`,
   * a third of a stop above the AA floor, so there is nothing underneath it and
   * the scale has to go *deeper* instead, ending near-black.
   *
   * Which means `data[0]` is the palest entry here and the brightest one there.
   * That is correct rather than an inconsistency: what a reader matches to a
   * legend is the hue and the position in the scale, and both hold. It is the
   * same reason `accent` itself is a lime in one scheme and an olive in the
   * other.
   *
   * Adjacent steps land at 1.192:1, within a thousandth of the dark palette's,
   * which is a coincidence of both scales having roughly a factor of 2.4 to
   * divide among five gaps rather than anything anyone arranged.
   */
  data: ['#54700A', '#4F621A', '#455616', '#3B4A13', '#303E0B', '#263108'],
};

/** 4-point spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Stroke widths. Two, and which one to use is not a matter of taste.
 *
 * `rule` is one physical pixel, and it is for **straight** lines only:
 * dividers, the band above a stat row, the top edge of the tab bar. A vertical
 * or horizontal line lands square on the pixel grid, so a single device pixel
 * draws crisp at any density and is the finest an interface can go.
 *
 * `outline` is a full point, and it is for **anything that follows a corner
 * radius**. A hairline is a third of a point on a 3x screen, which is less than
 * one pixel of ink for the renderer to distribute along a curve: Android's
 * anti-aliasing then fades the stroke in and out around the arc, and the result
 * is a corner that looks stepped and speckled rather than drawn. That is what
 * the accent outline on a selected chip looked like, and no colour or radius
 * change fixes it: only giving the curve a whole pixel to work with does.
 *
 * The corollary, for anything using these: an outline's resting colour should
 * match the fill it sits on rather than being `transparent`. A transparent
 * stroke over an opaque background is a hole punched in the shape's edge, which
 * on Android can leave a faint seam where the two paths meet, and a border
 * that only exists in one state also changes the control's inner width when it
 * appears.
 */
export const stroke = {
  rule: StyleSheet.hairlineWidth,
  outline: 1,
} as const;

/**
 * The type ladder, ported wholesale from Nuvio's `NuvioTokens.Type`.
 *
 * The key names are this app's and the values are that ladder's, because the
 * two scales disagree about how many steps there are between body and a page
 * title. Nuvio spends thirteen sizes where this app spends eight, so each key
 * below names the rung of theirs it now sits on rather than a number picked to
 * sit near it:
 *
 *   xs 11  labelXs      sm 13  bodySm       md 15  bodyApp
 *   lg 16  bodyLg       xl 18  titleSm      xxl 22 titleMd
 *   xxxl 28 titleLg     display 38 pageDisplay
 *
 * Three of the eight are unchanged (`xs`, `sm`, `md`: the reading sizes). The
 * other five all come *down*: 17→16, 20→18, 24→22, 32→28, 40→38. It is a
 * tighter ladder than the one it replaces and the compression grows towards the
 * top, so the fixed-width places are the ones to check: the list rows, the stat
 * band, and the calendar cells. The family's taller x-height gives some of it
 * back; see `fontFamily` below.
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
  display: 38,
} as const;

/**
 * Line heights, keyed to match `fontSize`, from Nuvio's `NuvioTokens.LineHeight`.
 *
 * New: this app set no line height at all before, which left every block of
 * text on the platform default. That default is not the same number on the two
 * platforms and it is not the same number as this, so multi-line text is the
 * other thing to look at after the size change above.
 *
 * The ratios run loose at the bottom of the ladder and tighten towards the top
 * (1.27 at `xs`, 1.47 at `md`, 1.11 at `display`), which is the ordinary shape
 * for a scale that has to serve both a caption and a page title. Set on the
 * variant rather than globally, so a call site that needs a single line to sit
 * on a fixed row can still override it.
 */
export const lineHeight = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 22,
  xl: 22,
  xxl: 26,
  xxxl: 32,
  display: 42,
} as const;

/**
 * Tracking, from Nuvio's `NuvioTokens.LetterSpacing`.
 *
 * Three values and a zero, against the six this app had. The shape of the rule
 * is the same one Apple applies to SF Pro's display cuts: type spaced for
 * running text looks loose once it is large, so the correction arrives at the
 * top of the ladder and nowhere else. What changes is where "the top" starts.
 * This app was correcting from 20px up in four graded steps; Nuvio corrects
 * only its two largest roles, and harder (-0.8 and -1.2 against -0.3 and -0.6).
 *
 * `label` is the one positive value, and it is for uppercase only. Small
 * mixed-case text gets nothing: at 11px and 13px the room goes to fitting words
 * into fixed columns rather than to letterspacing.
 */
export const letterSpacing = {
  none: 0,
  pageDisplay: -1.2,
  headline: -0.8,
  label: 0.8,
} as const;

/**
 * The app's typeface, bundled from `assets/fonts`.
 *
 * The family is JetBrains Sans, taken from Nuvio, which bundles exactly these
 * three cuts. The files keep the family's own names now rather than being
 * renamed for the role they play: the family they replaced was Spotify Mix,
 * shipped under a `LiftSans-*` alias because it was not a family this project
 * had a licence to redistribute. That reason is gone and the alias went with
 * it. **The licence here is not squarely established either** — the TTFs carry
 * no licence record in their `name` table (IDs 13 and 14 are absent) and the
 * family is JetBrains' brand face rather than their OFL-licensed Mono. Worth
 * settling before this ships anywhere public.
 *
 * Naming a face per weight is not a stylistic preference. Weight is selected by
 * *which font is named*, because on Android asking a runtime-loaded family for
 * a weight it was not registered under does not fall back to the loaded face.
 * It falls back to the *system* one. `font()` below carries the mechanism and
 * the consequence in full; the short version is that these names are the only
 * lever there is, and `fontWeight` is an iOS-side detail.
 *
 * The names below must match the keys `useFonts` is given in `app/_layout.tsx`;
 * nothing else in the app names a font.
 *
 * **Five roles over three faces, so two pairs collapse**, and which way each
 * one collapses is the decision worth knowing about:
 *
 * `medium` goes *up* to SemiBold rather than down to Regular. It is what
 * `bodyMedium` and `label` are set in, and folding it downwards would leave
 * those two indistinguishable from `body` and `caption` — a distinction erased
 * at the body end of the ladder, where it is most visible. Nuvio sets its own
 * labels in SemiBold for the same reason. The cost is that a 13px label is now
 * a shade heavier than it was at 500.
 *
 * `display` goes *down* to Bold, because the family has no 800 and because it
 * is what Nuvio sets its own page titles in. The three headline roles were
 * Extrabold and are now one step lighter.
 *
 * Unlike the family it replaces, this one has a real 600, so `semibold` finally
 * names a SemiBold instead of borrowing Bold.
 *
 * Nothing is set below 400: no lighter cut is loaded, and on a true-black
 * canvas at 11px a Light would be a hairline. If a role ever needs to feel
 * lighter, take the colour down a tier (`textSecondary`, `textTertiary`)
 * rather than the weight.
 *
 * Two measured things worth knowing, both re-measured off these files rather
 * than carried over:
 *
 * Its figures are proportional by default and the spread is wide — a 61% gap
 * between the narrowest and widest digit in Regular — but all three cuts ship a
 * real `tnum` feature, so the `numeric` and `numericLarge` variants switch
 * tabular figures on and columns of numbers align. That is what keeps a rest
 * timer from reflowing on every tick. Digits set through any *other* variant
 * are proportional and will shift as they change.
 *
 * Its x-height is 0.512em, against the 0.495em of the family it replaces. That
 * is the one thing working against the smaller `fontSize` ladder above: text
 * sits about 3% larger per point, so the sizes coming down by 1–2pt costs less
 * apparent size than the numbers suggest. The fixed-width columns are still the
 * ones to check (list rows, the stat band, calendar cells), and if they now
 * look loose rather than tight, the knob is `fontSize`, not wider columns.
 */
export const fontFamily = {
  regular: 'JetBrainsSans-Regular',
  /** No 500 in the family. Folds up, not down: see the note above. */
  medium: 'JetBrainsSans-SemiBold',
  semibold: 'JetBrainsSans-SemiBold',
  bold: 'JetBrainsSans-Bold',
  /** Headlines: `display`, `title`, `heading`. No 800 in the family. */
  display: 'JetBrainsSans-Bold',
} as const;

/** The roles a call site can ask for, by intent rather than by number. */
export type FontWeightName = keyof typeof fontFamily;

/**
 * Mirrors the *loaded* face rather than the name's nominal weight, so iOS is
 * never asked to synthesise a cut the file does not contain. `medium` reads 600
 * and `display` reads 700 for exactly that reason: they name a SemiBold and a
 * Bold, because the family ships no 500 and no 800.
 *
 * Read on iOS only. See `font()` for why Android is never told a weight.
 */
export const fontWeight = {
  regular: '400',
  medium: '600',
  semibold: '600',
  bold: '700',
  display: '700',
} as const;

/**
 * The style that renders text in a given weight of the bundled family.
 *
 * **On Android it deliberately does not set `fontWeight`, and that is not a
 * simplification. Naming a weight there is what makes the font disappear.**
 *
 * The chain, because it is not guessable and it cost a release to find. Fonts
 * loaded at runtime are registered by `expo-font` with
 * `ReactFontManager.setTypeface(family, Typeface.NORMAL, typeface)`: one entry,
 * under the *normal* style. When a `Text` also carries a weight, RN resolves it
 * through `TypefaceStyle.nearestStyle`, which is `BOLD` for anything ≥ 700. It
 * looks up the family's BOLD slot, finds nothing there, and falls back to
 * `createAssetTypeface`, which hunts the APK for `assets/fonts/<family>_bold.ttf`.
 * A file that only exists when fonts are shipped natively rather than loaded.
 * That misses too, and the last line of that function is
 * `Typeface.create(fontFamilyName, style)`: an unknown family name, which
 * Android answers with the *system* face.
 *
 * So every 700 and 800 role in the app: page titles, section headings, button
 * labels, every figure set in `numeric`: rendered in Roboto, while 400 and 500
 * came out correct because their `nearestStyle` is NORMAL and hits the one slot
 * that was registered. That is exactly the half-right rendering this looked
 * like: the app appeared to be using its own font for body copy and the
 * system's for everything that mattered.
 *
 * Dropping the weight leaves `nearestStyle` at NORMAL, which hits the
 * registered typeface, and the weight is not lost, because it never came from
 * this property in the first place. Each role names its own *face*
 * (`JetBrainsSans-SemiBold`, `JetBrainsSans-Bold`), which is the whole reason
 * `fontFamily` above is per weight rather than one family name.
 *
 * iOS keeps the weight. There it resolves within the family rather than
 * indexing a style slot, and it is what the OS accessibility tooling reads.
 */
export function font(weight: FontWeightName): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  if (Platform.OS === 'android') return { fontFamily: fontFamily[weight] };

  return { fontFamily: fontFamily[weight], fontWeight: fontWeight[weight] };
}

/**
 * Heights for anything the user taps or types into.
 *
 * Buttons, text fields and the search bar all read from this scale, so a button
 * sitting next to an input lines up instead of missing it by two pixels. `md`
 * is the default everywhere and equals `MIN_TOUCH_SIZE`; `sm` is below the
 * touch minimum on purpose and is only for controls inside an already-tappable
 * row (a set row's stepper), where the row itself carries the target.
 */
export const controlHeight = {
  sm: 36,
  md: 44,
  lg: 52,
} as const;

/**
 * Depth, expressed as a surface step rather than a shadow.
 *
 * A drop shadow is black, so on the AMOLED palette it is invisible against the
 * canvas: the dark theme separates layers with the neutral ramp and a hairline
 * border instead. Shadows stay for the light palette, where they still read.
 */
export function elevation(level: 0 | 1 | 2 | 3, isDark = true) {
  if (level === 0 || isDark) return {};

  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.06 * level,
      shadowRadius: 4 * level,
      shadowOffset: { width: 0, height: level },
    },
    android: { elevation: level * 2 },
    default: {},
  });
}

/** Minimum touch target. Set rows are dense, so this is enforced deliberately. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH_SIZE = 44;
