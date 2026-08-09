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

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Production dependencies (better-sqlite3 loads its bundled prebuild at
# runtime), the package manifest, and the built server.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build

# Everything mutable lives under /data: control.db, users/<id>/gain.db, the
# verbatim plan documents and generated exports. A single volume snapshot is a
# complete backup (§3).
VOLUME ["/data"]

EXPOSE 3000

# adapter-node serves the app. ORIGIN, OIDC_*, SESSION_SECRET and TZ arrive
# from the compose environment.
CMD ["node", "build"]