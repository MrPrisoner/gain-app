# syntax=docker/dockerfile:1
#
# GAIN — one image, one container, one port, one volume (ARCHITECTURE §3).
# Node 24 LTS everywhere, matching .nvmrc and the package.json engines field
# (§12). The internal port is fixed at 3000; the host port is the compose knob.

# ---------------------------------------------------------------------------
# Build stage: full dependency tree (dev deps needed for vite build), then
# prune down to production-only modules for the runtime image.
# ---------------------------------------------------------------------------
FROM node:24-bookworm AS build
WORKDIR /app

# Install everything first for layer caching. `prepare` (svelte-kit sync) runs
# here and succeeds because the dev dependencies are present.
COPY package.json package-lock.json ./
RUN npm ci

# Build the adapter-node server bundle, then drop the dev dependencies.
# better-sqlite3 ships prebuilt binaries in the package, so no compilation
# happens at any point and no build tools are required.
COPY . .
RUN npm run build \
    && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime stage: the built app plus production node_modules, nothing else.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# The compose file sets TZ (§3); Debian slim does not ship the timezone
# database, so install it for correct local-time logging.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

# CI passes the release tag it already computes for the image tag (--build-arg
# APP_VERSION=...); it's baked in here rather than read from package.json,
# which nothing keeps in sync with the actual tag.
ARG APP_VERSION=dev

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    APP_VERSION=$APP_VERSION

# Production dependencies (better-sqlite3 loads its bundled prebuild at
# runtime), the package manifest, and the built server.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/build ./build

# Everything mutable lives under /data: control.db, users/<id>/gain.db, the
# verbatim plan documents and generated exports — one volume is the entire backup
# surface. Not a live `tar` of it, though: the databases are WAL-mode, so a copy
# taken mid-write can tear a .db/-wal pair. Stop the container, or use VACUUM INTO
# (§3, and README's Backups subsection).
#
# Created and chowned before the VOLUME declaration on purpose: Docker seeds a
# named volume from the image's directory, ownership included, so `node` owns
# its data from the first boot. A *bind* mount keeps the host's ownership
# instead — chown the host directory to uid 1000, or the container cannot
# write its database.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Nothing here needs root: the app writes only under /data and listens on an
# unprivileged port. The node images ship this user at uid 1000.
USER node

EXPOSE 3000

# The same check compose runs, so a bare `docker run` is also observable (§3).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# adapter-node serves the app. ORIGIN, OIDC_*, SESSION_SECRET and TZ arrive
# from the compose environment.
CMD ["node", "build"]
