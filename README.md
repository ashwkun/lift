# IronLog

A local-first workout tracker in the spirit of Hevy. Everything works offline;
an account is optional and only adds backup and cross-device sync.

```
ironlog/
├── apps/mobile      Expo SDK 57 · React Native 0.86 · expo-router
├── apps/api         NestJS 11 · Postgres · better-auth
└── packages/shared  domain logic — no React, no database, fully tested
```

## Getting started

Requires Node 22+, pnpm, and (for the API) Docker.

```bash
pnpm install
pnpm --filter @ironlog/shared build   # the API consumes compiled JS
```

### Mobile

A native dev build is required — `expo-sqlite` and the notification modules are
not available in Expo Go.

```bash
cd apps/mobile
npx expo run:android      # or run:ios on a Mac
```

The app is fully usable at this point, with no backend running.

### API

```bash
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET
docker compose up -d postgres
cd apps/api && pnpm db:migrate && pnpm start:dev
```

Point the app at it with `EXPO_PUBLIC_API_URL`. If unset, the app derives the
API host from the Metro address, which is usually what you want on a physical
device — `localhost` there resolves to the phone.

## Testing

```bash
pnpm --filter @ironlog/shared test    # 41 unit tests
python3 apps/api/test/sync-e2e.py     # 28 end-to-end tests, needs a running API
```

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

`apps/api/Dockerfile` is a multi-stage build that runs unprivileged with a
healthcheck that actually round-trips to Postgres. On Dokploy, point at that
Dockerfile and supply the same environment variables as `.env.example`.

Two things worth doing on day one: turn on scheduled database backups, and
verify a restore. This app holds people's multi-year training history.
