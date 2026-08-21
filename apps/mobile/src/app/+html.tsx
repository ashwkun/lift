/**
 * The document the web build is served in.
 *
 * Rendered once, at export time, in Node — never in the browser and never on
 * native. Nothing here re-renders, so nothing here can read the theme context:
 * this file's job is specifically the frames *before* React exists, and after
 * that `useWebChrome` takes over the same properties from the real palette.
 *
 * Based on Expo Router's default shell. `ScrollViewStyleReset` is the load-
 * bearing part of that default and is not optional — react-native-web renders a
 * root `ScrollView` that expects the document not to scroll, and without the
 * reset the page gets two scrollbars, one of which moves nothing.
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The canvas, before JavaScript.
 *
 * A static export is HTML first and an app a beat later, and in that gap the
 * browser paints its own default — white. This app is dark by default and says
 * why in the theme provider: it is used in dim rooms far more often than bright
 * ones, and a white flash at 6am is genuinely unpleasant. On the web that flash
 * is not hypothetical, it is every single load until the bundle parses.
 *
 * `prefers-color-scheme` is the only signal available this early. It is not
 * always the right answer — someone who has forced light or dark in Settings
 * overrides the OS, and that preference lives in SQLite, which does not exist
 * yet — so this matches the app's *default* behaviour rather than guessing: the
 * provider also falls back to dark when the system scheme is unknown.
 *
 * The two values are `darkPalette.background` and `lightPalette.background`.
 * They are duplicated here rather than imported because this file is rendered
 * by a different bundler pass and inlined into static HTML; importing the
 * palette would pull the theme module into the document shell for two strings.
 * If the canvas colours ever change, they change in both places.
 */
const PREBOOT = `
:root { color-scheme: dark; }
html, body { margin: 0; background-color: #000000; }
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; }
  html, body { background-color: #F4F4F6; }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          `viewport-fit=cover` is the addition to Expo's default. Without it a
          notched phone letterboxes the page inside the safe area, so the app's
          own canvas stops short of the screen edges and the notch region is
          drawn in the browser's colour rather than the app's — which is the one
          thing the AMOLED palette exists to avoid. The insets are still
          reported, so `useSafeAreaInsets` keeps working; this only says the
          background may run underneath them.
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* Colours the browser's own chrome — the address bar on Android, the
            title bar of an installed PWA — to match the canvas behind it. */}
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#F4F4F6" media="(prefers-color-scheme: light)" />

        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: PREBOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
