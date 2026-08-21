<p align="center">
  <img src="docs/banner.png" alt="Lift — local-first workout tracker" width="560">
</p>

<p align="center">
  <a href="https://github.com/pawan67/lift/actions/workflows/android.yml">
    <img src="https://github.com/pawan67/lift/actions/workflows/android.yml/badge.svg" alt="Android build status">
  </a>
</p>

A local-first workout tracker in the spirit of Hevy. Everything works offline;
an account is optional and only adds backup and cross-device sync.

```
lift/
├── apps/mobile      Expo SDK 57 · React Native 0.86 · expo-router
├── apps/api         NestJS 11 · Postgres · better-auth
├── apps/landing     Next 16 · Tailwind v4 · the marketing page
└── packages/shared  domain logic — no React, no database, fully tested
```

## Install on Android

Download the APK from [the latest release](https://github.com/pawan67/lift/releases/latest)
and open it on the phone. Android will ask you to allow installs from your
browser the first time.

Builds are produced by [`.github/workflows/android.yml`](.github/workflows/android.yml)
— push a `v*` tag to cut a release, or run the workflow by hand from the
Actions tab to get an APK as a build artifact. Two things to know:

- **arm64-v8a only** by default, which covers any phone from the last decade.
  The workflow's `architectures` input builds the other ABIs if you need them.
- **Signed with the debug key** that Expo's prebuild template ships. That key
  is a fixed file in the template rather than something generated per machine,
  so CI-built and locally-built APKs share a signature and install over each
  other. It also means the APK is not publishable to the Play Store as-is.

Sync needs the API to be reachable from the phone. Set the `API_URL`
repository variable before building — a release build has no Metro server to
infer a host from, so it otherwise falls back to `localhost`, which on a phone
means the phone itself.

## Getting started

Requires Node 22+, pnpm, and (for the API) Docker.

```bash
pnpm install
pnpm --filter @lift/shared build   # the API consumes compiled JS
```

### Mobile

A native dev build is required — `expo-sqlite` and the notification modules are
not available in Expo Go.

```bash
cd apps/mobile
npx expo run:android      # or run:ios on a Mac
```

The app is fully usable at this point, with no backend running.

To produce a release APK locally rather than in CI:

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install
cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

`android/` and `ios/` are gitignored — prebuild regenerates them, so nothing
generated is committed. The one piece of hand-written native code lives in
`apps/mobile/modules/workout-live`, a local Expo module that prebuild links
rather than overwrites.

### Desktop web

The same app, same code, same database — laid out for a window instead of a
phone. Below 840px it is the phone layout unchanged; above it the bottom tab bar
becomes a persistent side rail, content is capped to a readable column rather
than stretched across the monitor, bottom sheets become centred dialogs, and
rows and buttons answer a cursor.

```bash
cd apps/mobile
npx expo start --web
```

Two things are worth knowing.

**The database is real, and it needs two headers.** In a browser `expo-sqlite`
is SQLite compiled to WebAssembly, storing through OPFS, and OPFS only hands out
the synchronous access handles it needs to a cross-origin-isolated document.
`metro.config.js` sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless`, but it does so through Metro's
`server.enhanceMiddleware`, which **only `expo start` reads**. `expo serve` and
every other way of hosting a built export are separate servers that never see
it.

So `expo start --web` is isolated and persists, and **anything serving the
exported files has to send those two headers itself**. Without them the app
still loads and still answers every query — from memory, silently, losing the
whole training log on reload. Check `crossOriginIsolated === true` in the
console of a deployed build before trusting it with data.

`apps/mobile/Dockerfile` is that server: it runs the export and serves it from
nginx with both headers set, which is what the `web` service in both compose
files builds. To check a built export locally before deploying one — the one
thing `expo start` cannot tell you, since it is the only server that reads
`enhanceMiddleware`:

```bash
docker compose --profile web up --build web   # then open http://localhost:8080
```

The API URL is a **build** argument, not an environment variable:
`EXPO_PUBLIC_*` is substituted into the bundle by Metro, so pointing the web app
at a different API means rebuilding the image. The build fails outright if it is
unset rather than falling back to the page's own hostname on port 3000, which is
right on a laptop and wrong behind a proxy.

**Notifications are the one thing the web build does not do.** Scheduling a
local alert for a future time has no browser equivalent without a service worker
and a push subscription, so the web target takes the same path as a phone with
the permission denied. The rest countdown, its bell and the docked timer all
work; what is missing is being told rest is over while the tab is in the
background. Session tokens go to `localStorage` there rather than the OS
keychain — see `features/sync/token-storage.ts`.

### API

```bash
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET
docker compose up -d postgres
cd apps/api && pnpm start:dev
```

The server applies any pending migrations as it boots, so there is no separate
migration step. `pnpm db:generate` writes a new one after a schema change;
`pnpm db:migrate` applies them by hand if you want that.

Point the app at it with `EXPO_PUBLIC_API_URL`. If unset, the app derives the
API host from the Metro address, which is usually what you want on a physical
device — `localhost` there resolves to the phone.

### Landing page

The marketing page, and the only part of this repository that is not the app.
Static, no data of its own, nothing to configure.

```bash
pnpm landing        # http://localhost:3000
```

It runs the app's own dark palette, copied out of the theme tokens rather than
re-picked, and draws the mark from the same geometry `scripts/generate-brand.sh`
does. `apps/landing/README.md` says where each piece comes from and what to
re-run when the mark or the screenshots change.

## Testing

```bash
pnpm --filter @lift/shared test    # 41 unit tests
python3 apps/api/test/sync-e2e.py     # 28 end-to-end tests, needs a running API
```

The end-to-end suite signs up several users in a few seconds, which the
production rate limit is there to stop. Run it against `pnpm start:dev`, or
against a container started with `NODE_ENV=development`, not against a
production one — the failures otherwise look like auth bugs.

## Design decisions

**Storage is canonical, display is derived.** Kilograms, kilometres and
centimetres in the database; unit preference is applied at the edge. Switching
between kg and lb never rewrites history or invalidates an aggregate.

**The active workout is a database row**, not in-memory state — a row with
`finishedAt IS NULL`. Force-quitting mid-set loses nothing.

**Deletes are soft, always.** A hard `DELETE` cannot replicate: the other device
has no way to learn the row ever existed. Every delete writes a `deletedAt`
tombstone that syncs like any other change.

**IDs are client-generated UUIDv7.** Creating a workout offline never waits on
the server, and the embedded timestamp gives free chronological ordering plus
index locality in Postgres.

**The pull cursor is a Postgres sequence, not a timestamp.** Wall clocks skew,
and two rows written in the same millisecond make `WHERE updated_at > cursor`
silently skip one forever. A sequence gives a strict total order over every
write across every table.

**Conflicts resolve last-write-wins, per row, ties going to the incumbent.**
Workouts belong to one user and are rarely edited from two devices at once;
CRDTs would buy nothing here at considerable cost. Preferring the existing row
on a tie makes replay idempotent.

**Pushes are idempotent.** A `(user, device, clientSeq)` receipt means a client
that pushes, loses connection before reading the response, and retries gets
acknowledged rather than double-applying.

**Warm-up sets are excluded from volume, 1RM and PR detection.** Counting them
would inflate every statistic in the app.

**The session notification holds no clock of its own.** Rest is stored as an
absolute deadline, and that epoch is handed to Android's notification
chronometer, which SystemUI ticks in its own process. So the countdown in the
shade is live and correct without this app running, and adjusting the timer
moves one number rather than resynchronising two. The Android foreground service
behind it (`modules/workout-live`) exists to keep the JavaScript runtime alive
so the notification's buttons reach a live store — not to count anything.

**1RM formulas are clamped.** Brzycki and Lander divide by `37 − reps`, so they
go infinite at 37 reps and negative beyond; past 30 they hand off to Epley,
which stays finite and monotonic.

## Deployment

`apps/api/Dockerfile` is a multi-stage build that runs unprivileged, applies
pending migrations before it starts listening, and carries a healthcheck that
round-trips to Postgres rather than returning a static 200.

On Dokploy:

1. Create a **Postgres** service and copy the connection URL it hands back.
2. Create a **Compose** application from this repository and set the compose
   path to `docker-compose.dokploy.yml`. That file defines the API, the web app
   and the landing page — the database is the service from step 1, not a
   container of its own.
3. Supply `DATABASE_URL` from step 1, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   as the public `https://` address including scheme, `TRUSTED_ORIGINS`, which
   has to list `lift://` or the app cannot complete an OAuth round trip,
   `EXPO_PUBLIC_API_URL`, the API's public URL as the browser will call it, and
   `NEXT_PUBLIC_SITE_URL`, the landing page's own public URL. All six are
   required; the stack refuses to start without them rather than inventing
   defaults.
4. Add three domains, one per service:

   | Service   | Port   | What it is             |
   | --------- | ------ | ---------------------- |
   | `api`     | `3000` | sync server            |
   | `web`     | `80`   | the app in a browser   |
   | `landing` | `3000` | the marketing page     |

   `api` and `landing` both name port 3000 and do not clash: they are separate
   containers, and the number is the port inside each one.
5. Add the `web` domain's origin to `TRUSTED_ORIGINS` —
   `lift://,https://app.example.com`. Without it the browser can load the app
   and then fails every request it makes, which reads as a broken sign-in
   rather than as a missing setting. The **landing page's origin does not go in
   here**: it makes no request the API has to trust, and listing it widens what
   the API accepts for nothing.

`EXPO_PUBLIC_API_URL` is baked into the web bundle at build time, so moving the
API means redeploying the web app, not restarting it. `NEXT_PUBLIC_SITE_URL` is
the same kind of value for the landing page — it is what the social card's image
URL is resolved against, so a wrong one leaves the page looking perfect while
every share preview comes back blank. The phone builds are unaffected by any of
this; they carry their own copy, set when the APK is built.

The schema is created on first boot. A migration that fails takes the container
down with it instead of serving against a half-applied schema, so a broken
deploy is reported as broken rather than quietly answering 500s.

`TRUSTED_PROXIES` defaults to Docker's private ranges, which is what Traefik
sits in. It only needs setting if something else — a CDN, another proxy — ends
up in front, in which case rate limiting counts that hop as the caller until
its ranges are added.

Two things worth doing on day one: turn on scheduled database backups, and
verify a restore. This app holds people's multi-year training history.

## Brand assets

Every icon, the splash image, the favicon and the banner above are generated
from a single vector definition:

```bash
./scripts/generate-brand.sh    # needs rsvg-convert and ImageMagick 7
```

Editing the mark means editing the geometry at the top of that script and
re-running it, rather than hand-editing seven PNGs. Each output needs its own
scale — Android crops the adaptive-icon layers to their central 66%, so the
foreground is drawn smaller than the iOS icon to land at the same apparent
size — and the script is where those ratios are recorded.
