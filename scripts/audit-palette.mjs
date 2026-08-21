#!/usr/bin/env node
/**
 * Checks the palette against every pairing the app actually makes.
 *
 * `apps/mobile/src/theme/tokens.ts` states a contrast ratio next to almost
 * every colour it defines, and those numbers are only worth anything if
 * something re-measures them. This does. It parses the two palettes straight
 * out of the tokens file — no import, so it needs no TypeScript and no bundler
 * — and fails loudly if a value has drifted below the line it claims.
 *
 *   node scripts/audit-palette.mjs
 *
 * Exits non-zero on the first failing invariant, so it can go in CI.
 *
 * The four families of check, and why each one exists:
 *
 * 1. **Role colour as text on each surface.** Every role is printed as text
 *    somewhere — sync status, a set-type badge, the PR marker — so each has to
 *    clear AA on the canvas, on a card, and inside a muted input.
 *
 * 2. **Named foreground on its role fill, resting and pressed.** This is the
 *    promise `textOnAccent` and friends make: a filled control cannot pick an
 *    unreadable foreground. It was being broken — white on the old danger red
 *    measured 3.06 — and the pressed state is the half that is easy to forget,
 *    because a fill that darkens under the thumb takes its label with it.
 *
 * 3. **Role text on its own tint.** Badges, chips and the destructive button
 *    print a role colour on `<role>Surface`, which is that same colour at low
 *    alpha. Contrast *falls* as the tint deepens, so this is the check that
 *    catches someone strengthening a tint to make it more visible.
 *
 * 4. **The system-level invariants.** The accent has to be the brightest role
 *    or it stops reading as the accent; `warning` and `record` have to be
 *    separated by hue, because a PR trophy is 13px and a lightness step does
 *    not register at that size; and a pressed fill must be darker than its
 *    resting one, or a press reads as a release.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TOKENS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'mobile',
  'src',
  'theme',
  'tokens.ts',
);

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
// Reading the palettes out of the tokens file
// ---------------------------------------------------------------------------

function readPalette(source, name) {
  const marker = `export const ${name}: Palette = {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${name} in ${TOKENS}`);

  const body = source.slice(start + marker.length).split('\n};')[0];
  const palette = {};
  for (const match of body.matchAll(/^\s*([a-zA-Z]+):\s*'([^']+)'/gm)) {
    palette[match[1]] = match[2];
  }
  return palette;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const ROLES = ['accent', 'success', 'warning', 'danger', 'record'];
const SURFACES = ['background', 'surface', 'surfaceMuted'];
const FOREGROUNDS = {
  accent: 'textOnAccent',
  success: 'textOnSuccess',
  warning: 'textOnWarning',
  danger: 'textOnDanger',
};

let failures = 0;
let checks = 0;

function expect(label, actual, minimum, unit = ':1') {
  checks += 1;
  const passed = actual >= minimum;
  if (!passed) failures += 1;
  const mark = passed ? '  ok ' : 'FAIL ';
  const shown = typeof actual === 'number' ? actual.toFixed(2) : actual;
  console.log(`${mark} ${label.padEnd(56)} ${String(shown).padStart(6)}${unit}`);
}

function auditPalette(name, palette) {
  console.log(`\n=== ${name} ===`);

  console.log('\n-- role colour as text on each surface --');
  for (const role of ROLES) {
    for (const surface of SURFACES) {
      expect(`${role} on ${surface}`, contrastRatio(palette[role], palette[surface]), AA);
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
   */
  if (name === 'DARK') {
    console.log('\n-- the accent must be the brightest role, or it is not the accent --');
    const ranked = ROLES.map((role) => [role, relativeLuminance(palette[role])]).sort(
      (a, b) => b[1] - a[1],
    );
    console.log(`      ${ranked.map(([r, l]) => `${r} ${l.toFixed(3)}`).join('  ')}`);
    expect('accent ranks first', ranked[0][0] === 'accent' ? 1 : 0, 1, '');
  }
}

// ---------------------------------------------------------------------------

const source = readFileSync(TOKENS, 'utf8');
const dark = readPalette(source, 'darkPalette');
const light = readPalette(source, 'lightPalette');

auditPalette('DARK', dark);
auditPalette('LIGHT', light);

console.log('\n=== cross-palette ===');
console.log('\n-- the two themes must name the same colours --');
for (const role of ROLES) {
  expect(
    `${role}: dark ${hue(dark[role])}° vs light ${hue(light[role])}°`,
    20 - hueGap(dark[role], light[role]),
    0,
    '',
  );
}

console.log('\n-- the completed set row: success plate on the lime-tinted row --');
for (const [name, palette] of [
  ['dark', dark],
  ['light', light],
]) {
  expect(
    `${name} success on accentSurface over surface`,
    contrastRatio(palette.success, flatten(palette.accentSurface, palette.surface)),
    AA,
  );
}

console.log(
  failures === 0
    ? `\nAll ${checks} checks pass.`
    : `\n${failures} of ${checks} checks FAILED.`,
);

process.exit(failures === 0 ? 0 : 1);
