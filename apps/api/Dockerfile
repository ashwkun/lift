# Multi-stage build for the Lift API inside a pnpm workspace.
#
# The build stage needs the workspace root (lockfile, shared package); the
# runtime stage carries only production dependencies and compiled output.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# pnpm asks before replacing an existing node_modules and aborts when there is
# no terminal to ask. Nothing here is interactive.
ENV CI=true

# ---------------------------------------------------------------- deps ------
FROM base AS deps

# Manifests first so a source-only change doesn't invalidate the install layer.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# The isolated linker overrides the root .npmrc, which hoists for Metro's sake.
# That setting is a mobile-development concern the API has no stake in, and
# under it `pnpm deploy` below cannot map packages back to the store: it falls
# back to resolving from the registry, quietly installing whatever satisfies the
# semver ranges rather than what the lockfile pins. That is how this image came
# to run a better-auth a minor version ahead of the one the schema was written
# for, which broke sign-up outright.
RUN pnpm install --frozen-lockfile --config.node-linker=isolated

# --------------------------------------------------------------- build ------
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# The API imports @lift/shared as compiled JS, so it must be built first.
RUN pnpm --filter @lift/shared build
RUN pnpm --filter @lift/api build

# Collect the API and its dependencies into one self-contained directory.
#
# `--legacy` because pnpm 10 otherwise insists on `inject-workspace-packages`,
# which would change how @lift/shared is linked for every other workspace
# project too. The node-linker is repeated here because deploy reads it again.
RUN pnpm --filter @lift/api --prod --config.node-linker=isolated deploy --legacy /deploy

# Fail the build, rather than the sign-up endpoint, if that ever happens again.
# The installed tree above is lockfile-exact; every direct dependency in the
# deployed copy must be the same version. A drift here is otherwise invisible —
# the container starts, the healthcheck passes, and only auth is broken.
RUN set -e; \
    for pkg in $(node -p "Object.keys(require('/app/apps/api/package.json').dependencies).filter((d) => d !== '@lift/shared').join(' ')"); do \
      locked=$(node -p "require('/app/apps/api/node_modules/$pkg/package.json').version"); \
      shipped=$(node -p "require('/deploy/node_modules/$pkg/package.json').version"); \
      [ "$locked" = "$shipped" ] || { echo "$pkg: lockfile pins $locked, image has $shipped"; exit 1; }; \
    done; \
    echo 'every direct dependency matches the lockfile'

# ------------------------------------------------------------- runtime ------
FROM base AS runtime

ENV NODE_ENV=production

# Run unprivileged. The node image ships a `node` user for exactly this.
USER node

COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./drizzle

EXPOSE 3000

# Dokploy reads this to decide whether a deploy succeeded. It hits the endpoint
# that actually round-trips to Postgres, not a static 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
