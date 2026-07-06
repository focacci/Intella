# Intella API — self-hosted, single-user deployment (T0.12).
# One image runs both the Fastify API and the re-runnable first-run `setup`
# (migrate + seed + mint-on-pair + pairing QR). The app runs straight from
# source via tsx — matching how the repo runs in dev — so there is no separate
# TS build step to keep in sync.

# ---- build: install deps + generate the Prisma client -----------------------
FROM node:22-bookworm-slim AS build
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The whole workspace is copied (node_modules/.git/db/backups excluded by
# .dockerignore). `pnpm install` runs the postinstall `prisma generate`, and
# builds the native better-sqlite3 binary against this base image.
COPY . .
RUN pnpm install --frozen-lockfile

# ---- runtime: same base so the native binary is ABI-compatible --------------
FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# Carry the fully-installed workspace (incl. the compiled better-sqlite3 and the
# dev tooling `setup` needs: tsx + the Prisma CLI).
COPY --from=build /app /app

# The bind-mounted data dir (intella.db + /backups) is provided by compose.
VOLUME ["/data"]
EXPOSE 8787

# Default: run the API. compose overrides this with `pnpm setup` for the
# one-shot setup service.
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
