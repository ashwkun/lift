#!/usr/bin/env node
/**
 * Checks the palette against every pairing the app actually makes.
 *
 * `apps/mobile/src/theme/tokens.ts` states a contrast ratio next to almost
 * every colour it defines, and those numbers are only worth anything if
 * something re-measures them. This does. It parses the palettes straight out of
 * the theme files, with no import, so it needs no TypeScript and no bundler,
 * and fails loudly if a value has drifted below the line it claims.
 *
 *   node scripts/audit-palette.mjs
 *
 * Every theme in `THEMES` is audited, and that list is read out of
 * `theme/index.tsx` rather than written down here. The six ported palettes in
 * `palettes.ts` shipped unmeasured for exactly that reason: a second file of
 * colours was added and the only thing checking colours still named the first
 * one. A theme added tomorrow is measured tomorrow.
 *
 * Exits non-zero on the first failing invariant, so it can go in CI.
 *
 * The six families of check, and why each one exists:
 *
 * 1. **Role colour as text on each surface.** Every role is printed as text
 *    somewhere — sync status, a set-type badge, the PR marker — so each has to
 *    clear AA on the canvas, on a card, and inside a muted input.
 *
 * 2. **The neutral text ramp on each surface.** `text`, `textSecondary` and
 *    `textTertiary` are the colours the app prints most: a role appears on a
 *    badge, these are every row of every screen. They were also the family
 *    nothing measured. `textTertiary` is the one tier that cannot clear AA in
 *    every palette, and the pairs where it cannot are named one at a time in
 *    `WAIVED` rather than the tier being dropped from the family.
 *
 * 3. **Named foreground on its role fill, resting and pressed.** This is the
 *    promise `textOnAccent` and friends make: a filled control cannot pick an
 *    unreadable foreground. It was being broken — white on the old danger red
 *    measured 3.06 — and the pressed state is the half that is easy to forget,
 *    because a fill that darkens under the thumb takes its label with it.
 *
 * 4. **Role text on its own tint.** Badges, chips and the destructive button
 *    print a role colour on `<role>Surface`, which is that same colour at low
 *    alpha. Contrast *falls* as the tint deepens, so this is the check that
 *    catches someone strengthening a tint to make it more visible.
 *
 * 5. **The category ramp.** `data` is six hues for telling one series from
 *    another, and it is held to the *text* bar rather than the graphical-object
 *    one, because the point of it is that a figure can be printed in its
 *    series' colour. Its entries also have to be mutually distinguishable by
 *    hue, which nothing else in the palette requires: two role colours are told
 *    apart by where they appear, two bars in one chart are not.
 *
 * 6. **The system-level invariants.** The accent has to be the brightest role
 *    or it stops reading as the accent; `warning` and `record` have to be
 *    separated by hue, because a PR trophy is 13px and a lightness step does
 *    not register at that size; and a pressed fill must be darker than its
 *    resting one, or a press reads as a release.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const THEME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'mobile',
  'src',
  'theme',
);

/** This app's own two palettes, with the reasoning for every value beside it. */
const TOKENS = join(THEME_DIR, 'tokens.ts');
/** The six ported ones: Nord, Gruvbox, Catppuccin, Spotify, Fitness, Solarized. */
const PALETTES = join(THEME_DIR, 'palettes.ts');
/** `THEMES`, which is the only place that says which palettes actually ship. */
const THEME_INDEX = join(THEME_DIR, 'index.tsx');

/** AA for body text. Everything the app prints a role colour as is body-sized. */
const AA = 4.5;

// ---------------------------------------------------------------------------
// Colour maths — the same definitions as `theme/color.ts`, kept standalone so
// this script has no build step between it and the file it is auditing.
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Accepts `#rgb`, `#rrggbb` and `rgba(r, g, b, a)` — the palette holds both. */
function parseColor(color) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(
    color,
  );
  if (!match) return { rgb: hexToRgb(color), alpha: 1 };
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/** Composites a possibly-translucent colour onto an opaque one. */
function flatten(color, base) {
  const top = parseColor(color);
  const under = parseColor(base);
  const channel = (i) => Math.round(top.rgb[i] * top.alpha + under.rgb[i] * (1 - top.alpha));
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(hex) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function hue(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  let value;
  if (max === r) value = ((g - b) / delta) % 6;
  else if (max === g) value = (b - r) / delta + 2;
  else value = (r - g) / delta + 4;

  value *= 60;
  return Math.round(value < 0 ? value + 360 : value);
}

/** Shortest way round the wheel — 357° and 30° are 33° apart, not 327°. */
function hueGap(a, b) {
  const raw = Math.abs(hue(a) - hue(b));
  return Math.min(raw, 360 - raw);
}

// ---------------------------------------------------------------------------
// Reading the palettes out of the theme files
// ---------------------------------------------------------------------------

/** Both files that declare palettes, read once. They use the same declaration. */
const SOURCES = [TOKENS, PALETTES].map((file) => [file, readFileSync(file, 'utf8')]);

function readPalette(name) {
  const marker = `export const ${name}: Palette = {`;
  for (const [, source] of SOURCES) {
    const start = source.indexOf(marker);
    if (start === -1) continue;

    const body = source.slice(start + marker.length).split('\n};')[0];
    const palette = {};
    for (const match of body.matchAll(/^\s*([a-zA-Z]+):\s*'([^']+)'/gm)) {
      palette[match[1]] = match[2];
    }
    // `data` is the one token that is a list. Read separately rather than by
    // loosening the line above, which would otherwise start matching the first
    // string of the array and calling it the whole value.
    const ramp = /^\s*data:\s*\[([^\]]+)\]/m.exec(body);
    if (ramp) palette.data = [...ramp[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return palette;
  }
  throw new Error(`Could not find ${name} in ${TOKENS} or ${PALETTES}`);
}

/**
 * The themes that ship, in the order `THEMES` declares them.
 *
 * Parsed rather than listed because a list here is a list that goes stale, and
 * a palette nobody measured is the whole reason this file grew. The regex is
 * deliberately loose about whitespace and strict about shape: it wants a key,
 * a `colors:` naming an exported palette, and a `scheme:`, which is every
 * entry `THEMES` can hold without failing to typecheck.
 *
 * `scheme` is read rather than inferred because it decides which invariants
 * apply: see the note on the accent ranking below.
 */
function readThemes() {
  const source = readFileSync(THEME_INDEX, 'utf8');
  const start = source.indexOf('export const THEMES');
  if (start === -1) throw new Error(`Could not find THEMES in ${THEME_INDEX}`);

  const body = source.slice(start).split('\n};')[0];
  const themes = [];
  for (const match of body.matchAll(/^\s*(\w+):\s*\{\s*colors:\s*(\w+),\s*scheme:\s*'(\w+)'/gm)) {
    themes.push({ name: match[1], palette: match[2], scheme: match[3] });
  }

  if (themes.length === 0) throw new Error(`Parsed no themes out of ${THEME_INDEX}`);
  return themes;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const ROLES = ['accent', 'success', 'warning', 'danger', 'record'];
const SURFACES = ['background', 'surface', 'surfaceMuted'];
const TEXT_TIERS = ['text', 'textSecondary', 'textTertiary'];
const FOREGROUNDS = {
  accent: 'textOnAccent',
  success: 'textOnSuccess',
  warning: 'textOnWarning',
  danger: 'textOnDanger',
};

/**
 * The invariants a specific palette is documented not to meet, and why each
 * one cannot be fixed by moving a colour.
 *
 * An allowlist rather than a softer bar. The check still runs, still prints its
 * real number and still fails for every palette not named here, so a waived
 * pair that gets *worse* shows up in a diff and a palette that has never been
 * looked at cannot inherit the exemption. Keys are `<theme>: <check label>`,
 * which is exactly what the run prints, so a new one can be copied off a
 * failing line.
 *
 * Adding to this list is the last resort, after the colour, its tint and the
 * surface under it have all been tried. Two entries have earned it:
 *
 * 1. **`textTertiary` on the light palette.** The tokens file states the
 *    ceiling next to the value: a third tier dark enough to reach 4.5 on
 *    `background` lands within a step of `textSecondary` and collapses the
 *    ramp from three tiers into two. The tier is decorative by rule instead:
 *    it may only repeat something a higher tier has already said (units beside
 *    a number, placeholders, row hints) and never carry the only copy of a
 *    fact. That rule is what is being waived here, and it is enforced by
 *    reading call sites, not by this script. Four sites currently break it;
 *    see `docs/palette-retune.md`.
 *
 * 2. **Fitness and the accent ranking.** Its accent is Apple's Move ring and
 *    no role fits underneath a crimson: it has to clear 4.5 against the canvas,
 *    the card, a muted fill *and* its own tint, and there is nothing left
 *    below. `palettes.ts` works through the alternative under `fitnessPalette`
 *    and shows that lifting the ring until it outranks the others turns it into
 *    a salmon. That palette answers the leftover problem by hue and by
 *    rationing instead, which is a real design decision about one theme rather
 *    than a number that drifted. It is the only palette here with a red accent,
 *    and `darkPalette` briefly was too: the lime went back because a red accent
 *    on that palette's lighter card ramp cannot be a red at all. The note under
 *    `data` in the tokens records what that cost.
 */
const WAIVED = {
  'light: textTertiary on background': 'decorative tier; see tokens.ts',
  'light: textTertiary on surface': 'decorative tier; see tokens.ts',
  'light: textTertiary on surfaceMuted': 'decorative tier; see tokens.ts',
  'fitness: accent ranks first': 'a crimson accent cannot outrank a role; see palettes.ts',
};

let failures = 0;
let checks = 0;
const waiversUsed = new Set();

/*
 * Which palette the next `expect` belongs to, for the waiver lookup.
 *
 * A module variable rather than a parameter threaded through every call. The
 * label is what a reader sees and what a waiver key is written against, and a
 * second argument on `expect` would put the two out of step the first time
 * someone added a check and forgot it.
 */
let scope = '';

function expect(label, actual, minimum, unit = ':1') {
  checks += 1;
  const passed = actual >= minimum;

  // Only consulted on failure, so a waiver costs nothing while the palette is
  // passing and stops applying the moment someone fixes the colour.
  const key = `${scope}: ${label}`;
  const waived = !passed && key in WAIVED;
  if (waived) waiversUsed.add(key);
  else if (!passed) failures += 1;

  const mark = passed ? '  ok ' : waived ? 'waive' : 'FAIL ';
  const shown = typeof actual === 'number' ? actual.toFixed(2) : actual;
  const note = waived ? `   (${WAIVED[key]})` : '';
  console.log(`${mark} ${label.padEnd(56)} ${String(shown).padStart(6)}${unit}${note}`);
}

function auditPalette(name, palette, scheme) {
  scope = name;
  console.log(`\n=== ${name} (${scheme}) ===`);

  console.log('\n-- role colour as text on each surface --');
  for (const role of ROLES) {
    for (const surface of SURFACES) {
      expect(`${role} on ${surface}`, contrastRatio(palette[role], palette[surface]), AA);
    }
  }

  console.log('\n-- the neutral text ramp on each surface --');
  for (const tier of TEXT_TIERS) {
    for (const surface of SURFACES) {
      expect(`${tier} on ${surface}`, contrastRatio(palette[tier], palette[surface]), AA);
    }
  }

  console.log('\n-- named foreground on its role fill --');
  for (const [role, foreground] of Object.entries(FOREGROUNDS)) {
    expect(
      `${foreground} on ${role}`,
      contrastRatio(palette[foreground], palette[role]),
      AA,
    );
  }

  console.log('\n-- and on the pressed fill, which is what a held control shows --');
  for (const [role, foreground] of Object.entries(FOREGROUNDS)) {
    const pressed = `${role}Pressed`;
    if (!palette[pressed]) continue;
    expect(
      `${foreground} on ${pressed}`,
      contrastRatio(palette[foreground], palette[pressed]),
      AA,
    );
  }

  console.log('\n-- role text on its own tint (badges, chips, the discard button) --');
  for (const role of ROLES) {
    for (const base of ['background', 'surface']) {
      expect(
        `${role} on ${role}Surface over ${base}`,
        contrastRatio(palette[role], flatten(palette[`${role}Surface`], palette[base])),
        AA,
      );
    }
  }

  console.log('\n-- a press must darken, never brighten --');
  for (const role of ['accent', 'success', 'danger']) {
    const pressed = `${role}Pressed`;
    if (!palette[pressed]) continue;
    const drop = relativeLuminance(palette[role]) - relativeLuminance(palette[pressed]);
    expect(`${pressed} is darker than ${role}`, drop > 0 ? 1 : 0, 1, '');
  }

  console.log('\n-- hue separation, so two roles cannot be mistaken for each other --');
  expect(
    `warning ${hue(palette.warning)}° vs record ${hue(palette.record)}°`,
    hueGap(palette.warning, palette.record),
    10,
    '°',
  );
  expect(
    `accent ${hue(palette.accent)}° vs success ${hue(palette.success)}°`,
    hueGap(palette.accent, palette.success),
    25,
    '°',
  );

  /*
   * Dark only, and not because light is exempt from having an accent.
   *
   * The invariant is written against the AMOLED palette, where every role is a
   * bright colour on a black canvas and "loudest" and "lightest" are the same
   * measurement. On the light palette they are opposites: the roles there are
   * text colours, all of them dark, and the accent leads on luminance by 0.008
   * — close enough that the check would pass or fail on rounding rather than on
   * anything anyone could see. A check that passes by coincidence is worse than
   * no check, because it will one day fail for a reason nobody can act on.
   * Solarized sits on the same side of that line and for the same reason: it is
   * a light theme whose roles are all deepened text colours.
   *
   * One dark palette is waived rather than exempted, and the difference
   * matters. Fitness cannot meet this, `palettes.ts` argues out why at length,
   * and that is a decision about one theme rather than a property of the
   * light/dark split, so it lives in `WAIVED` next to the number it costs.
   */
  console.log('\n-- the category ramp, which is printed as text and not only drawn --');
  palette.data.forEach((color, index) => {
    for (const surface of SURFACES) {
      expect(`data[${index}] ${color} on ${surface}`, contrastRatio(color, palette[surface]), AA);
    }
  });

  /*
   * The tint a category tone draws behind its own glyph.
   *
   * `surfaces.tsx` derives this rather than reading a token, because six tints
   * per palette across eight palettes is forty-eight values nobody would
   * hand-solve. Derived is not the same as unchecked: a `ListRow` prints a 17px
   * glyph on exactly this colour, so the same 4.5 the roles clear on their own
   * `*Surface` applies. The alpha here has to track the one in `toneColors`.
   */
  console.log('\n-- a category glyph on the tint that component derives for it --');
  palette.data.forEach((color, index) => {
    // Index 0 is the accent and takes `accentSurface`, which is solved rather
    // than derived: see the note in `toneColors`. Measured here anyway, because
    // what is being checked is the pairing the component actually draws.
    const [r, g, b] = hexToRgb(color);
    const tint = index === 0 ? palette.accentSurface : `rgba(${r}, ${g}, ${b}, 0.16)`;
    for (const base of ['background', 'surface']) {
      expect(
        `data[${index}] on its category tint over ${base}`,
        contrastRatio(color, flatten(tint, palette[base])),
        AA,
      );
    }
  });

  /*
   * Every pair, not each neighbour, and separated by hue *or* by luminance.
   *
   * Every pair, because the ramp is handed out in order but nothing stops a
   * screen from spending index 1 and index 5 on the two things it draws.
   * Checking only adjacent pairs would pass a ramp whose ends wrap round onto
   * each other, which is exactly the mistake a hue list ordered warm-to-cool
   * invites.
   *
   * Either criterion, because there are two kinds of ramp here and only one of
   * them is polychrome. Six themes spend `data` on five or six hues, and 20° is
   * the bar those clear: lower than the 25° the roles hold, because three of
   * the ports quote source projects that crowd their own warm hues and cannot
   * do better without rotating a colour away from the value the theme is
   * recognised by. `light` and `dark` spend it on one hue and six lightnesses
   * instead, which `tokens.ts` argues out at length under `data`, and no hue
   * bar can be met by a scale that has only one.
   *
   * 1.15:1 for the luminance route, which is a **weak** bar and is set where it
   * is on purpose. A single-hue ramp is bounded by its accent above and by AA
   * below, and on both palettes that leaves a factor of about 2.4 to divide
   * among five gaps: 1.19 is what the arithmetic allows, so a bar above it
   * would fail a ramp that cannot be improved rather than catch one that can.
   * What it does catch is a scale with a duplicate or a wasted step in it.
   *
   * Which route carried each pair is printed, so a polychrome ramp that has
   * quietly collapsed into a monochrome one is visible in the output rather
   * than merely passing.
   */
  console.log('\n-- and no two of its entries may be mistaken for each other --');
  for (let i = 0; i < palette.data.length; i += 1) {
    for (let j = i + 1; j < palette.data.length; j += 1) {
      const [first, second] = [palette.data[i], palette.data[j]];
      const gap = hueGap(first, second);
      const step = contrastRatio(first, second);

      // Normalised so one `expect` can report either: 1.0 is exactly at
      // whichever bar the pair is being held to, and the label says which.
      const byHue = gap / 20;
      const byStep = step / 1.15;
      const hueWins = byHue >= byStep;

      expect(
        hueWins
          ? `data[${i}] vs data[${j}]: ${gap}° apart`
          : `data[${i}] vs data[${j}]: ${step.toFixed(2)}:1 apart, same hue`,
        Math.max(byHue, byStep),
        1,
        '×',
      );
    }
  }

  /*
   * The ramp leads with the accent, repeated rather than approximated.
   *
   * This is what lets a chart adopt `data` without changing how it looks today:
   * one series still draws in the accent. It is also the check that catches the
   * likelier drift, which is someone retuning `accent` and leaving the ramp
   * holding the old value. String equality, not a contrast measurement, because
   * "close enough" is the failure being prevented.
   */
  expect(
    `data[0] ${palette.data[0]} is the accent ${palette.accent}`,
    palette.data[0].toLowerCase() === palette.accent.toLowerCase() ? 1 : 0,
    1,
    '',
  );

  if (scheme === 'dark') {
    console.log('\n-- the accent must be the brightest role, or it is not the accent --');
    const ranked = ROLES.map((role) => [role, relativeLuminance(palette[role])]).sort(
      (a, b) => b[1] - a[1],
    );
    console.log(`      ${ranked.map(([r, l]) => `${r} ${l.toFixed(3)}`).join('  ')}`);
    expect('accent ranks first', ranked[0][0] === 'accent' ? 1 : 0, 1, '');
  }
}

// ---------------------------------------------------------------------------

const themes = readThemes();
const palettes = new Map(themes.map((theme) => [theme.name, readPalette(theme.palette)]));

for (const theme of themes) {
  auditPalette(theme.name, palettes.get(theme.name), theme.scheme);
}

console.log('\n=== cross-palette ===');

/*
 * The app's own two only, and the ports are not being let off.
 *
 * This asks whether the light rendering of a theme names the same colours as
 * its dark one, and `light` and `dark` are the only pair that are two views of
 * one design. The six ports are each a single palette quoting somebody else's
 * hues: Nord's accent is a frost blue and Gruvbox's is a green, and there is no
 * counterpart for either to agree with. Running this across them would only
 * measure how unalike Nord and Gruvbox are, which is the point of shipping
 * both.
 */
const dark = palettes.get('dark');
const light = palettes.get('light');

scope = 'cross-palette';
console.log('\n-- the two themes must name the same colours --');
for (const role of ROLES) {
  expect(
    `${role}: dark ${hue(dark[role])}° vs light ${hue(light[role])}°`,
    20 - hueGap(dark[role], light[role]),
    0,
    '',
  );
}

// Every theme renders this row, so every theme is measured on it. The tint is
// the lime only on the two palettes this app designed; elsewhere it is whatever
// that theme made its accent, which is exactly what makes the pairing worth
// re-checking per palette rather than once.
console.log('\n-- the completed set row: success plate on the accent-tinted row --');
for (const theme of themes) {
  const palette = palettes.get(theme.name);
  scope = theme.name;
  expect(
    `${theme.name} success on accentSurface over surface`,
    contrastRatio(palette.success, flatten(palette.accentSurface, palette.surface)),
    AA,
  );
}

/*
 * A waiver nobody needs is the same rot as a check nobody runs, so it is
 * reported. It is not a failure: the only way to get here is for a palette to
 * have improved, and failing CI on an improvement teaches people to stop
 * improving things.
 */
const stale = Object.keys(WAIVED).filter((key) => !waiversUsed.has(key));
if (stale.length > 0) {
  console.log(`\nWaivers that now pass on their own, delete them:`);
  for (const key of stale) console.log(`  ${key}`);
}

const waivedNote = waiversUsed.size === 0 ? '' : ` ${waiversUsed.size} waived.`;
console.log(
  failures === 0
    ? `\nAll ${checks} checks pass.${waivedNote}`
    : `\n${failures} of ${checks} checks FAILED.${waivedNote}`,
);

process.exit(failures === 0 ? 0 : 1);
