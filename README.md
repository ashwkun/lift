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

`android/` and `ios/` are gitignored — prebuild regenerates them, and nothing
native is committed.

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
   path to `docker-compose.dokploy.yml`. That file defines the API alone —
   the database is the service from step 1, not a container of its own.
3. Supply `DATABASE_URL` from step 1, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   as the public `https://` address including scheme, and `TRUSTED_ORIGINS`,
   which has to list `lift://` or the app cannot complete an OAuth round trip.
   All four are required; the stack refuses to start without them rather than
   inventing defaults.
4. Add a domain pointing at the `api` service on port 3000.

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
