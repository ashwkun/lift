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
rather than restarting; the Dockerfile refuses to build without it.

## Deploying

`apps/landing/Dockerfile` builds it, and the `landing` service in both compose
files uses that. In Dokploy it wants **its own domain, routed to `landing` on
port 3000**. The same number the API uses, which is fine because they are
separate containers.

To check the built image before it goes anywhere:

```bash
docker compose --profile landing up --build landing   # http://localhost:8090
```

It ships as a Node server rather than an export, and that is not incidental. The
download button names the version and size of the release GitHub is currently
serving, which it reads from GitHub's API and revalidates hourly. An exported
page would freeze that at whatever was true when the image was built, which is
the bug the hardcoded version constant used to have.

The version is **not** read from `package.json`, and that is deliberate. A
release exists once a `v*` tag is pushed and the Android workflow attaches an
APK to it, which happens after the version bump: in between, `package.json`
names a version nobody can download. See the header of `lib/release.ts`.

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

The typeface is the app's, now that it can be. The page ran Archivo for as long
as the app ran Spotify Mix, a licence this project could not redistribute over
the web; the app moved to JetBrains Sans in `bfda0f5`, and JetBrains publishes
that family for the web, so the page is set in the same face the phone is. The
three cuts live in `app/fonts` rather than being pathed across the workspace,
because `Dockerfile` only copies `apps/landing` into the build stage. See the
note in `app/layout.tsx` for which weights are registered and why one of them is
registered twice.

## Screenshots

The page frames eight PNGs out of [`screenshots/`](../../screenshots) at the
repository root, the same set the root README shows. `lib/screens.ts` imports
them by name and carries their alt text; the imports are static, so Next reads
each file's real dimensions at build time and there is no declared geometry here
to fall out of step with the images.

They are retaken by script rather than off a phone by hand:

```bash
cd apps/mobile && npx expo start --web        # in one terminal
node scripts/screenshots/capture.mjs --fresh  # in another
```

This directory used to keep its own `public/screens`, thirteen WebP captures at
a taller geometry, taken by the same harness under a `--landing` flag. Both are
gone. Two sets of photographs of the same screens is two sets to keep true, and
the copy on this page drifted from its own images the first time the app moved.
The cost of the merge is that `capture.mjs` no longer takes the rest timer, the
muscle-sets breakdown, the exercise library, import or backup, so those sections
are set as text with no device beside them. Adding a shot back to `SHOTS` is
what it takes to give any of them a phone again.

The training log behind every figure is generated from a fixed seed, so the
numbers are the app's own arithmetic over a year that belongs to nobody. An alt
text or a sentence here that quotes a figure has to be re-read off the new image
when the set is retaken. The root README's Screenshots section has the rest.

Because the images live outside this directory, `Dockerfile` copies
`screenshots/` into the build stage alongside `apps/landing`. That is the same
constraint the fonts note above describes, answered the other way: the fonts are
small enough to keep a copy of, and a phone screenshot per screen is not.

## Social card and icons

```bash
./scripts/generate-og.sh    # needs rsvg-convert, ImageMagick 7 and curl
```

Writes `app/opengraph-image.png`, `app/icon.png` and `app/apple-icon.png`, which
Next picks up by filename. It draws the same mark geometry and fetches Archivo
for the render, so the card cannot drift from the page.
