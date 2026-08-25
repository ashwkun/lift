# Multi-stage build for the Lift web app inside a pnpm workspace.
#
# The build stage needs the workspace root (lockfile, shared package) and runs
# Metro; the runtime stage is nginx and a directory of static files. Nothing of
# Node survives into the image that ships.
#
# This is the same app as the phone build, exported for a browser — see the
# "Desktop web" section of the README for what changes and what does not.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# pnpm asks before replacing an existing node_modules and aborts when there is
# no terminal to ask. Nothing here is interactive.
ENV CI=true

# ---------------------------------------------------------------- deps ------
FROM base AS deps

# Manifests first so a source-only change doesn't invalidate the install layer.
# The API's is copied too, not because anything here needs it, but because
# `--frozen-lockfile` compares the lockfile against every workspace project it
# names: with one manifest missing the install fails as out of date.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/

# The patch file `pnpm-workspace.yaml` names under `patchedDependencies`, and
# for this image it is load-bearing rather than bookkeeping: it is the fix to
# expo-sqlite's web worker channel, without which every query result over 255
# bytes comes back truncated mid-JSON and each screen renders its empty state.
# pnpm hashes it during install, so an absent `patches/` fails with ENOENT.
COPY patches patches/

# No `--config.node-linker=isolated` here, unlike the API image. That override
# exists because the API has no stake in the root .npmrc's hoisting; this build
# runs Metro, which is the reason the hoisting is there. `@lift/mobile...`
# installs the app and the workspace packages it depends on, and nothing else.
RUN pnpm install --frozen-lockfile --filter @lift/mobile...

# --------------------------------------------------------------- build ------
FROM deps AS build

# Baked in, not read at runtime.
#
# Metro substitutes `EXPO_PUBLIC_*` into the bundle at build time, so this is a
# property of the image rather than of the container: starting it with a
# different value changes nothing, and pointing the app somewhere else means
# rebuilding.
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/mobile apps/mobile

# Refused rather than defaulted, and refused here rather than discovered in a
# browser. Unset, `resolveApiUrl` falls back to the page's own hostname on port
# 3000 — which is right on a laptop and wrong behind Traefik, where the API is
# a different hostname on 443. The app would load, look entirely healthy, and
# fail every sync against a port nothing is listening on.
RUN test -n "$EXPO_PUBLIC_API_URL" || { \
      echo 'EXPO_PUBLIC_API_URL is empty. Pass it as a build arg — it is baked into the bundle.'; \
      exit 1; \
    }

# The web target resolves `@lift/shared` through its `default` export condition,
# which is compiled JS. Metro reads the source on native; a browser does not.
RUN pnpm --filter @lift/shared build
RUN pnpm --filter @lift/mobile exec expo export --platform web

# ------------------------------------------------------------- runtime ------
FROM nginx:1.29-alpine AS runtime

# `.wasm` has been in nginx's own mime.types since 1.21.5, so this is a guard
# rather than a fix: served as application/octet-stream, the WebAssembly
# database fails to instantiate through the streaming compiler and the app
# falls back to no storage at all. Cheap enough to not depend on the base image.
RUN grep -q 'application/wasm' /etc/nginx/mime.types \
    || sed -i '/^types {/a\    application/wasm                      wasm;' /etc/nginx/mime.types

COPY apps/mobile/nginx/cross-origin-isolation.conf /etc/nginx/snippets/
COPY apps/mobile/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html

EXPOSE 80

# Dokploy reads this to decide whether a deploy succeeded. The root document is
# the whole product here — if that is being served, the container is doing its
# job — so there is no separate health route to shadow an app one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1/index.html || exit 1
