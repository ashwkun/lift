# @lift/landing

The marketing page for Lift. One route, statically rendered, no data of its own.

```bash
pnpm --filter @lift/landing dev     # or `pnpm landing` from the root
pnpm --filter @lift/landing build
```

Next 16 (App Router, Turbopack), Tailwind v4, shadcn/ui primitives on Base UI.

## The one setting

`NEXT_PUBLIC_SITE_URL` is the origin this page is served from, and a deploy has
to set it. Next resolves the social card against it, so left unset the card's
URL points at localhost and every share preview comes back blank. It is
substituted into the bundle at build time, so moving the site means rebuilding
rather than restarting.

## Where the design comes from

Nothing here invents a palette. `app/globals.css` carries the app's dark tokens
copied verbatim out of `apps/mobile/src/theme/tokens.ts`, kept as hex rather
than converted, because those values were measured against the surfaces they
print on and `scripts/audit-palette.mjs` at the repository root re-measures
them. A second copy in a second colour space would drift the first time either
moved. `docs/palette-retune.md` is the reasoning.

Two things are lifted rather than eyeballed, and both have the derivation in a
comment beside them:

- The volume band's four fills are `mix(surfaceMuted, accent, f)` at the stops
  in `features/analytics/month-grid.tsx`.
- The mark in `components/site/mark.tsx` is the four rectangles at the top of
  `scripts/generate-brand.sh`, mask included. Editing the mark means editing
  that script and copying the geometry across.

The typeface is not the app's. The app is set in Spotify Mix, bundled into the
APK and not something this project may redistribute over the web, so the page
uses Archivo and Azeret Mono and leans on Archivo's width axis to land near the
same voice. See the note in `app/layout.tsx`.

## Screenshots

`public/screens` holds thirteen 1080x2340 captures off a real phone with a real
training log behind them, converted to WebP. `lib/screens.ts` names them and
carries their alt text. Replacing one means replacing the file and, if what it
shows changed, the sentence next to it.

## Social card and icons

```bash
./scripts/generate-og.sh    # needs rsvg-convert, ImageMagick 7 and curl
```

Writes `app/opengraph-image.png`, `app/icon.png` and `app/apple-icon.png`, which
Next picks up by filename. It draws the same mark geometry and fetches Archivo
for the render, so the card cannot drift from the page.
