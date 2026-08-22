/**
 * Colour arithmetic.
 *
 * Everything here takes `#rgb` or `#rrggbb` and returns `#rrggbb`. The
 * palette's `*Surface` tokens are `rgba(...)` strings and are **not** valid
 * input. They are already the result of a blend, and the opaque tokens they
 * were blended from are what belongs here.
 *
 * This lives in the theme rather than beside its first caller because two
 * features now shade a surface from the palette and then have to print text on
 * top of the result: the body map's volume ramp and the calendar's day grid.
 * Deciding what colour that text is cannot be done by eye once the background
 * is computed, which is what `readableOn` is for.
 */

import type { Palette } from './tokens';

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((n) =>
        Math.round(Math.max(0, Math.min(255, n)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Linear blend in sRGB. Good enough across the short hops between adjacent stops. */
export function mix(from: string, to: string, factor: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const f = Math.max(0, Math.min(1, factor));
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

/**
 * The fill a control takes under a cursor: halfway from resting to pressed.
 *
 * One rule, derived rather than chosen, because hover is a state the palette
 * does not name and should not have to. Every control in this app already
 * declares where it goes under a finger; a cursor is the same journey stopped
 * partway, so the hover colour is a function of the two ends rather than a third
 * token to keep in step with them.
 *
 * Halfway rather than all the way. Hover taking the pressed fill outright is the
 * common mistake and it costs the click its feedback: the control lights up when
 * the cursor arrives and then does nothing at the moment it is actually
 * activated, which reads as a dead button on a live row.
 *
 * Both arguments must be hex: see the note at the top of this file. A control
 * whose resting fill is `transparent` has nothing to blend from and should name
 * its hover colour directly.
 */
export function hoverFill(resting: string, pressed: string): string {
  return mix(resting, pressed, 0.5);
}

/**
 * The same tint, carrying more or less of itself.
 *
 * The complement to everything above it: those take `#rrggbb` and reject the
 * palette's `rgba(...)` tokens, and this one takes only those. It exists for
 * the tinted controls (the destructive button is the first) which need a
 * resting, a hover and a pressed depth of *one* colour without the palette
 * naming three tokens per role to say it.
 *
 * Alpha rather than a blend towards a darker colour, because the tint has to
 * composite over whatever is behind it. A destructive button sits on the canvas
 * on one screen and on a card on another, and a hex value baked against one of
 * those is visibly wrong on the other.
 *
 * The result is clamped at 1. Going the other way is unclamped on purpose:
 * `factor` below 1 is how a caller asks for a fainter version, and there is no
 * floor worth enforcing.
 *
 * A word of warning for anyone reaching for a bigger factor. Strengthening a
 * tint that a role colour is *printed on* moves the two closer together, so
 * contrast falls as the fill deepens. The pressed state is the one most likely
 * to fail. On the dark palette, danger's own label goes under AA at roughly
 * 1.5×. That is why the destructive button presses mostly through its outline;
 * see `danger` in `ui/button.tsx`.
 */
export function scaleAlpha(color: string, factor: number): string {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(
    color,
  );
  if (!match) return color;

  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${Math.min(1, alpha * factor)})`;
}

/** WCAG relative luminance: the perceived lightness a contrast ratio is built on. */
function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio: 1 for two identical colours, 21 for black on white. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Whichever of the palette's two foregrounds actually reads on `background`.
 *
 * A computed fill cannot pick its own text colour from a constant. The
 * calendar shades a day from `surfaceMuted` towards `accent`, and the point
 * where the correct foreground flips is not the same in the two palettes: on
 * dark, the ramp starts at a near-black olive (light text) and ends at electric
 * lime (dark text); on light it starts at a pale sage (dark text) and ends at a
 * deep olive (light text). Measuring both candidates and taking the better one
 * gets that right in both schemes without any call site branching on the theme.
 *
 * The candidates are `text` and `textOnAccent` because those are the palette's
 * two ends: see the note on `textOnAccent` in the tokens for why the app does
 * not simply use white.
 */
export function readableOn(background: string, colors: Palette): string {
  return contrastRatio(background, colors.text) >= contrastRatio(background, colors.textOnAccent)
    ? colors.text
    : colors.textOnAccent;
}
