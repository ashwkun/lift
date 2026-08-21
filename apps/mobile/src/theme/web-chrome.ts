/**
 * The parts of a browser this app has to dress, and cannot dress from a
 * stylesheet React Native owns.
 *
 * Three things live outside every React tree there is — the document's own
 * background, the scrollbars and form controls the browser draws, and the focus
 * ring it puts on whatever has keyboard focus. React Native Web has no style
 * prop for any of them, so on the web they keep their defaults, and all three
 * defaults are wrong against an AMOLED palette: a white gutter behind the app
 * when a scroll overshoots, a light scrollbar down the side of a black page, and
 * a focus ring drawn in a colour picked to be visible on white.
 *
 * Everything here is a no-op off the web.
 *
 * ## Why a CSS variable rather than re-injecting the sheet
 *
 * The palette can change while the app is running — the theme preference is a
 * setting, and 'system' follows the OS at runtime. Rewriting a `<style>` element
 * on every change invalidates the document's style rules and forces a full
 * restyle; setting one custom property re-resolves only the rules that reference
 * it. The rule text is therefore static and injected once, and the colours move
 * through `--lift-*`.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { ColorScheme } from './index';
import type { Palette } from './tokens';

const STYLE_ID = 'lift-web-chrome';

const RULES = `
/*
 * The document fills the viewport and does not bounce.
 *
 * Without the heights, a short route leaves the body shorter than the window
 * and the app's canvas stops partway down the screen. \`overscroll-behavior\`
 * turns off the rubber-band and, on touch laptops and phones, pull-to-refresh —
 * which in a local-first app reloads the entire bundle to fetch nothing.
 *
 * The canvas colour is deliberately *not* set here. \`+html.tsx\` paints it
 * before this file exists, from \`prefers-color-scheme\`, and a rule in this
 * sheet would win the cascade with a variable that is undefined for the first
 * frame after the sheet lands — reintroducing the white flash the shell exists
 * to prevent. It is handed over imperatively below instead, where there is no
 * window in which it is unset.
 */
html, body { height: 100%; overscroll-behavior-y: none; }

/*
 * The keyboard focus ring, and only the keyboard one.
 *
 * \`:focus-visible\` is the browser's own judgement about whether focus arrived
 * from a key or from a click, which is exactly the distinction wanted: every
 * pressable in this app is a tab stop (react-native-web gives anything with a
 * button or link role \`tabIndex="0"\`), so a plain \`:focus\` rule would ring
 * every row the moment it was clicked.
 *
 * Offset rather than inset so the ring sits outside the control's own fill
 * instead of over it, and 2px rather than 1 because the accent on a true-black
 * canvas at one pixel is a hairline. Modern browsers follow \`border-radius\`
 * with the outline, so a rounded card gets a rounded ring for free.
 */
:focus-visible {
  outline: 2px solid var(--lift-focus);
  outline-offset: 2px;
}

/*
 * Text is selectable, but chrome is not.
 *
 * A desktop user expects to be able to drag across a workout note and copy it,
 * and react-native-web leaves \`Text\` selectable, so that works. What it also
 * leaves selectable is every label inside a button, so dragging across a list
 * highlights the words in the rows rather than scrolling or doing nothing. The
 * roles below are all controls; none of them contain anything worth copying.
 */
[role="button"], [role="link"], [role="tab"], [role="switch"] {
  user-select: none;
  -webkit-user-select: none;
}
`;

/**
 * Applies the palette to the document.
 *
 * `color-scheme` is the important line and the least obvious. It is not a
 * colour: it tells the browser which of its *own* built-in renderings to use, so
 * one property gives correctly-themed scrollbars, text-selection highlights,
 * spinner controls on number inputs and the default background behind the page.
 * Restyling scrollbars by hand with `::-webkit-scrollbar` would be a worse
 * version of this — a reinvented standard affordance that only works in Blink,
 * and one that has to be maintained against two palettes.
 */
export function useWebChrome(colors: Palette, scheme: ColorScheme): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = RULES;
      document.head.appendChild(style);
    }

    const root = document.documentElement;
    root.style.setProperty('--lift-focus', colors.accent);
    root.style.setProperty('color-scheme', scheme);

    /*
     * The canvas, taken over from `+html.tsx`.
     *
     * Set as an inline style on the elements themselves rather than through a
     * variable the injected sheet reads. An inline style beats any rule, so the
     * handover is atomic — there is no frame in which the shell's colour has
     * been overridden by a rule whose variable has not been set yet.
     *
     * `html` as well as `body`, because the two disagree at the edges: an
     * overscroll past the end of the document exposes the canvas behind the
     * root element, not the body's.
     *
     * This is also the point where the *user's* preference finally wins. The
     * shell could only read `prefers-color-scheme`; by the time this runs,
     * settings have been hydrated from SQLite, so someone who forced light on a
     * dark OS gets their light canvas here.
     */
    root.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;
  }, [colors, scheme]);
}
