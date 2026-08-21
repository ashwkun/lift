/**
 * Design tokens.
 *
 * Both palettes define the *same* key set so components can read
 * `colors.surface` without ever branching on scheme. Semantic names
 * (`surface`, `textSecondary`) rather than literal ones (`gray800`) because the
 * light palette inverts lightness — a name like `gray800` would be a lie in one
 * of the two themes.
 */

import { Platform, StyleSheet, type TextStyle } from 'react-native';

export interface Palette {
  /** App canvas, behind everything. Pure black in dark mode — see `darkPalette`. */
  background: string;
  /** Cards, list rows, sheets. */
  surface: string;
  /** Raised surfaces: modals, menus, sheets that sit above a card. */
  surfaceElevated: string;
  /** Subtle fills — input backgrounds, chips, table stripes. */
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
   * `record` are bright enough that white on top lands at or below 2:1 contrast
   * — legible only if you already know what it says. Each role names its own
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
}

/**
 * AMOLED dark palette.
 *
 * `background` is true `#000000` so the panel leaves those pixels physically
 * unlit — deeper blacks, and less battery burnt on a screen that is mostly
 * background. Everything above it is a deliberate step on a single neutral
 * ramp (`#000` → `0C` → `16` → `1E` → `26`), which is what keeps a card, a
 * modal and a pressed row visibly distinct instead of three guesses at "dark
 * grey".
 *
 * Text is `#F5F5F7` rather than pure white: at 21:1 on black, white text
 * blooms on OLED and reads as if it is vibrating. This still clears WCAG AAA.
 */
export const darkPalette: Palette = {
  background: '#000000',
  surface: '#0C0C0F',
  surfaceElevated: '#16161A',
  surfaceMuted: '#1E1E24',
  surfacePressed: '#26262E',
  border: '#22222A',
  borderStrong: '#3A3A46',

  text: '#F5F5F7',
  textSecondary: '#A1A1AC',
  // Lifted from #6E6E7A, which measured 4.17 on the canvas, 3.88 on `surface`
  // and 3.30 inside a `surfaceMuted` input — below AA everywhere it is actually
  // printed, and this tier carries the previous-set column and the unchecked
  // check glyph. It now reads 5.68 / 5.28 / 4.48 on those same three surfaces,
  // so the third tier clears AA even on the darkest fill.
  textTertiary: '#84848F',

  /*
   * Electric lime — the one saturated colour in the app, and the reason the
   * dark canvas reads as deliberate rather than absent. It sits at ~78%
   * relative luminance, so on black it is the brightest thing on screen by a
   * wide margin: one accent element per view is usually the correct number.
   *
   * That last sentence only holds if nothing else competes, and for a long time
   * everything did. The four role colours below ran at 62–100% saturation and
   * 51–68% lightness — five near-maximum colours, none subordinate — so the
   * lime was not read as *the* accent, it was read as one of the loud ones.
   * They are now placed underneath it on purpose. The invariant, worth checking
   * whenever one of them moves: **`accent` outranks every other role in
   * relative luminance.** Currently 0.783 against record 0.593, success 0.466,
   * warning 0.377, danger 0.260.
   */
  accent: '#D2F34B',
  accentPressed: '#B6D634',
  // 0.15 rather than the 0.16 the other roles use — lime is bright enough that
  // an equal alpha makes the tint read as a filled surface instead of a hint.
  accentSurface: 'rgba(210, 243, 75, 0.15)',

  /*
   * Yellow-green rather than emerald, and that is the fix for a mismatch you
   * could see on every completed set.
   *
   * A checked-off row tints `accentSurface` — lime, hue 72° — and the check
   * plate inside it fills `success`, which was #34D07A at hue 147°. Two greens
   * 75° apart, touching, on the one interaction this app exists to perform.
   * That gap is the worst of both worlds: too close to read as a deliberate
   * contrast, too far to read as one family, so the row read as two colours
   * that had been chosen by different people.
   *
   * 115° sits 43° off the lime — far enough that "done" still reads as green
   * and never as a second accent, close enough that the plate and the row it
   * sits in belong to the same family. Saturation comes down to 53% against the
   * lime's 87% for the reason in the block above: this is a confirmation, not
   * the subject of the screen. 10.32 on the canvas, 9.59 on `surface`, 8.15 on
   * `surfaceMuted` — the plate's own resting fill.
   */
  success: '#63CC5A',
  successPressed: '#4FAF48',
  successSurface: 'rgba(99, 204, 90, 0.16)',

  /*
   * Burnt orange, not amber — and this is the same collision the light palette
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
   * #FF5A5A was hue 0° at 100% saturation and 68% lightness — the only role in
   * the palette sitting on a primary, and the lowest-contrast one at 6.86. It
   * also blooms on OLED for the same reason pure white text does, which is why
   * `text` is #F5F5F7 rather than #FFF.
   *
   * The white foreground was the real defect. `textOnDanger` measured **3.06**
   * on it — below AA, on the label of every filled Discard and Delete button in
   * the app, in a palette whose whole premise is that a role names a foreground
   * so a filled control cannot pick an unreadable one. It cannot be fixed by
   * darkening the red either: white only reaches 4.5 around #B3282E, which is a
   * muddy brick on a true-black canvas.
   *
   * So the foreground goes dark like every other role here, which reads at 5.52
   * and lets the red stay bright enough to belong to this palette. Destructive
   * *buttons* no longer fill at all — see `danger` in `ui/button.tsx` — so the
   * fill that remains is the swipe-to-delete plate and the filled header pill,
   * where an unmistakable red is the point.
   */
  danger: '#EC5A62',
  /*
   * A shallower step down than the other roles take, and it is the dark
   * foreground that sets the floor.
   *
   * A pressed fill has to be darker than its resting one — a press that
   * brightens a control reads as a release — but `textOnDanger` is now dark, so
   * every step down also costs label contrast. #D13F48 was the natural depth
   * and took the label to 4.02, which is the same AA failure this palette just
   * fixed, moved from the resting state to the held one. This is the darkest
   * value that still clears it: 4.72 for the label, and a luminance of 0.215
   * against the resting 0.260, which is a visible step.
   */
  dangerPressed: '#E04B54',
  dangerSurface: 'rgba(236, 90, 98, 0.16)',

  /** Personal-record gold. Held at 43°; see `warning` for why it moved away. */
  record: '#F5C445',
  recordSurface: 'rgba(245, 196, 69, 0.16)',

  textOnAccent: '#12180A',
  textOnSuccess: '#06170A',
  textOnWarning: '#1A1002',
  // Dark, not white. See the note on `danger` — white measured 3.06 here.
  textOnDanger: '#2A0507',

  overlay: 'rgba(0, 0, 0, 0.72)',
  skeleton: '#16161A',
  // Softer than pure white: a full-white plate against a true-black canvas is
  // a glare source at 6am, and the artwork's dark ink stays legible well below
  // that brightness.
  mediaPlate: '#E8E8EC',
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
  // 6.20 on `background`, 6.82 on `surface`. The previous #6B6B75 measured 4.80
  // — nominally a pass, but it sat so close to the AA line that the tier below
  // it had nowhere left to go.
  textSecondary: '#5A5A64',
  // 4.09 on `background`, 4.49 on `surface`, and that is the honest ceiling: a
  // third tier dark enough to reach 4.5 on `background` lands within a step of
  // `textSecondary` and collapses the neutral ramp from three tiers into two.
  // The previous #95959F measured 2.70. Because this token cannot be made to
  // pass, it is only ever used for text that repeats something already stated
  // in a higher tier — units beside a number, placeholders, row hints — and
  // never for the only copy of a fact.
  textTertiary: '#767681',

  // The same yellow-green hue as the dark palette, dropped to a depth where it
  // still works as *text*. `accent` is read as a foreground far more often than
  // as a fill (ghost buttons, active tabs, links), and the dark palette's lime
  // on white is roughly 1.3:1 — invisible. This clears AA on both `surface` and
  // `background`; the lime itself survives in `accentSurface`.
  accent: '#54700A',
  accentPressed: '#3F5406',
  accentSurface: 'rgba(163, 209, 30, 0.22)',

  /*
   * Hue 111°, tracking the dark palette's move off emerald — see `success`
   * there for why the app no longer has two unrelated greens.
   *
   * Depth is set by a case the dark palette does not have. Every tinted control
   * prints its role colour on that role's own `*Surface`, and on white a tint
   * barely darkens the ground, so the text has to carry nearly the full
   * contrast alone: #2F7A20, which is the direct lightness match for the dark
   * value, measured 4.28 on its own tint and failed. This reads 5.94 on
   * `background`, 6.52 on `surface`, and 5.14 on `successSurface` over a card.
   *
   * `successPressed` has to go *down* from here rather than up — a pressed
   * value lighter than the resting one makes a press brighten the button.
   */
  success: '#2A6B1E',
  successPressed: '#1E4E14',
  successSurface: 'rgba(42, 107, 30, 0.10)',

  // 5.40 on `background`, 5.93 on `surface`; #D97706 measured 2.90. Burnt
  // orange rather than amber so that it and `record` cannot be confused — see
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
  // `surface`, and 4.92 on its own `recordSurface` tint over a card — the badge
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
 * `rule` is one physical pixel, and it is for **straight** lines only —
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
 * change fixes it — only giving the curve a whole pixel to work with does.
 *
 * The corollary, for anything using these: an outline's resting colour should
 * match the fill it sits on rather than being `transparent`. A transparent
 * stroke over an opaque background is a hole punched in the shape's edge, which
 * on Android can leave a faint seam where the two paths meet — and a border
 * that only exists in one state also changes the control's inner width when it
 * appears.
 */
export const stroke = {
  rule: StyleSheet.hairlineWidth,
  outline: 1,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  display: 40,
} as const;

/**
 * The app's typeface, bundled from `assets/fonts`.
 *
 * The files are named for the role they play here rather than for the family
 * they are, which is Spotify Mix — recorded once, in the one place a maintainer
 * would look, because the measurements below are only meaningful if you know
 * what was measured, and because it is not a family this project has a licence
 * to redistribute.
 *
 * Naming a face per weight is not a stylistic preference. Weight is selected by
 * *which font is named*, because on Android asking a runtime-loaded family for
 * a weight it was not registered under does not fall back to the loaded face —
 * it falls back to the *system* one. `font()` below carries the mechanism and
 * the consequence in full; the short version is that these four names are the
 * only lever there is, and `fontWeight` is an iOS-side detail.
 *
 * The names below must match the keys `useFonts` is given in `app/_layout.tsx`;
 * nothing else in the app names a font.
 *
 * The archive ships eight upright cuts, 200 through 1000. Four are loaded, and
 * the floor is deliberate: **nothing in this app is set below 400.** The
 * family's Thin and Light are real and usable on paper, and on a true-black
 * canvas at 11px they are a hairline — which is what the previous family was,
 * and why it lasted one build. If a role ever needs to feel lighter, take the
 * colour down a tier (`textSecondary`, `textTertiary`) rather than the weight.
 *
 * There is no 600 in the family — it steps 500 → 700 — so `semibold` names
 * Bold. The role keeps its name because call sites read by intent.
 *
 * Two measured things worth knowing:
 *
 * Its figures are proportional by default and the spread is wide — a 77% gap
 * between the narrowest and widest digit in Regular — but it ships a real
 * `tnum` feature, so the `numeric` and `numericLarge` variants switch tabular
 * figures on and columns of numbers align. That is what keeps a rest timer from
 * reflowing on every tick. Digits set through any *other* variant are
 * proportional and will shift as they change.
 *
 * It is wide, and its x-height is low (0.495em) for how much room it takes: on
 * the row titles this app sets it runs 10–15% past the family it replaced, and
 * at the same pixel size it looks slightly smaller into the bargain. That is
 * roughly where Open Sans sat when titles were clamping, so the fixed-width
 * columns — list rows, the stat band, calendar cells — are the ones to check.
 * If they truncate, the knob is `fontSize` below, not narrower columns.
 */
export const fontFamily = {
  regular: 'LiftSans-Regular',
  medium: 'LiftSans-Medium',
  /** No 600 in the family; Bold is the next real cut above Medium. */
  semibold: 'LiftSans-Bold',
  bold: 'LiftSans-Bold',
  /** Headlines: `display`, `title`, `heading`. Black (900) is one line away. */
  display: 'LiftSans-Extrabold',
} as const;

/** The roles a call site can ask for, by intent rather than by number. */
export type FontWeightName = keyof typeof fontFamily;

/**
 * Mirrors the *loaded* face rather than the name's nominal weight, so iOS is
 * never asked to synthesise a cut the file does not contain. `semibold` reads
 * 700 for exactly that reason — it is Bold, because the family has no 600.
 *
 * Read on iOS only. See `font()` for why Android is never told a weight.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '700',
  bold: '700',
  display: '800',
} as const;

/**
 * The style that renders text in a given weight of the bundled family.
 *
 * **On Android it deliberately does not set `fontWeight`, and that is not a
 * simplification — naming a weight there is what makes the font disappear.**
 *
 * The chain, because it is not guessable and it cost a release to find. Fonts
 * loaded at runtime are registered by `expo-font` with
 * `ReactFontManager.setTypeface(family, Typeface.NORMAL, typeface)` — one entry,
 * under the *normal* style. When a `Text` also carries a weight, RN resolves it
 * through `TypefaceStyle.nearestStyle`, which is `BOLD` for anything ≥ 700. It
 * looks up the family's BOLD slot, finds nothing there, and falls back to
 * `createAssetTypeface`, which hunts the APK for `assets/fonts/<family>_bold.ttf`
 * — a file that only exists when fonts are shipped natively rather than loaded.
 * That misses too, and the last line of that function is
 * `Typeface.create(fontFamilyName, style)`: an unknown family name, which
 * Android answers with the *system* face.
 *
 * So every 700 and 800 role in the app — page titles, section headings, button
 * labels, every figure set in `numeric` — rendered in Roboto, while 400 and 500
 * came out correct because their `nearestStyle` is NORMAL and hits the one slot
 * that was registered. That is exactly the half-right rendering this looked
 * like: the app appeared to be using its own font for body copy and the
 * system's for everything that mattered.
 *
 * Dropping the weight leaves `nearestStyle` at NORMAL, which hits the
 * registered typeface — and the weight is not lost, because it never came from
 * this property in the first place. Each role names its own *face*
 * (`LiftSans-Bold`, `LiftSans-Extrabold`), which is the whole reason
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
 * canvas — the dark theme separates layers with the neutral ramp and a hairline
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
