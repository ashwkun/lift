# Multi-stage build for the IronLog API inside a pnpm workspace.
#
# The build stage needs the workspace root (lockfile, shared package); the
# runtime stage carries only production dependencies and compiled output.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# ---------------------------------------------------------------- deps ------
FROM base AS deps

# Manifests first so a source-only change doesn't invalidate the install layer.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------- build ------
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# The API imports @ironlog/shared as compiled JS, so it must be built first.
RUN pnpm --filter @ironlog/shared build
RUN pnpm --filter @ironlog/api build

# Drop dev dependencies from the installed tree before it's copied forward.
RUN pnpm --filter @ironlog/api --prod deploy /deploy

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
