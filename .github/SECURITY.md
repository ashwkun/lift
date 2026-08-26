# Security policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/pawan67/lift/security/advisories/new).
That form is private to the maintainers until an advisory is published, so it
is the right place for anything that should not be a public issue.

Please do not open a public issue for a vulnerability first. This app is
distributed as a sideloaded APK, so there is no store review and no staged
rollout between a disclosure and someone's phone.

What helps most, in rough order:

- Which part is affected. The three are quite different: the app on the device
  (`apps/mobile`), the sync API (`apps/api`), and the release pipeline itself
  (`.github/workflows`).
- The version. The APK's is on the settings screen, and it is in the file name
  of every release asset.
- Whether the sync API is the hosted one or your own. Self-hosting is a
  supported path, so half of the deployments are not ones the maintainers can
  look at.

Expect an acknowledgement within a week. This is a small project maintained by
one person, so a fix is a best-effort matter of days rather than a contractual
window.

## Supported versions

The latest release only. Updates reach installed apps over the air, so there
is no long-lived branch to backport to: a JavaScript fix ships as an OTA update
and reaches every install on its next launch, and anything native is a new APK.

## Scope

In scope:

- The sync API: authentication, the push, pull and status endpoints, and
  anything that lets one account read or write another's rows.
- The app: local database handling, the exported backup file, the deep-link
  scheme (`lift://`), and the Android foreground service and widgets.
- The release pipeline: anything that could get code into a release APK or an
  over-the-air update without passing through a commit on `main`.

Out of scope, because they are already documented behaviour rather than
findings:

- **The release APK is signed with the debug key** that Expo's prebuild
  template ships. This is stated at the top of `.github/workflows/android.yml`.
  It is adequate for sideloading onto your own device and it is not a
  publishable signing setup. Anyone verifying provenance should compare the
  build against the workflow run that produced it.
- **Sync stores workout data unencrypted at rest** on whichever server it is
  pointed at. The server never needs to read a value, but it can: this is
  ordinary server-side storage, not end-to-end encryption, and self-hosting is
  the answer the project offers today.
- **The exported backup is plain JSON** and is deliberately readable. That is
  the point of it.
- Reports produced by an automated scanner against a dependency that the app
  never reaches at runtime, with no path to exploitation shown.

## What the project already does

- Every third-party action in `.github/workflows` is pinned to a commit SHA, so
  a retagged or compromised `v4` cannot reach a runner holding `EXPO_TOKEN`.
- `.github/dependabot.yml` moves dependencies and actions weekly rather than
  when someone remembers.
- CI runs the sync suite against a real Postgres on every push, which is where
  the cross-account and ordering assertions live.

If you find that one of those is not true, that is itself worth reporting.
