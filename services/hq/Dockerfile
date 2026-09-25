# Agency HQ — the Cat Intelligence Agency's own server (services/hq/).
#
# Built from the REPOSITORY ROOT as the context (Railway: leave "Root Directory" empty and set
# the service variable RAILWAY_DOCKERFILE_PATH=services/hq/Dockerfile, docs/hq/DEPLOY.md),
# because HQ runs the extension's, the bots' and the vendored executor's own modules rather
# than copies of them. Only what HQ imports is copied
# (test-hq-deploy.mjs follows the imports of server.mjs, cli.mjs, keygen.mjs and
# admin-client.mjs and fails if one is missing here). No secret is baked in: every one comes
# from the host's variables at run time.
#
# Node is pinned to the 22 line HQ is tested on: node:sqlite (HQ's database) is built into
# Node 22 and still marked experimental there, so a new major is a deliberate upgrade.
FROM node:22.22.2-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# HQ's own dependencies (services/hq/package.json), installed exactly from its lockfile, then
# made visible to the shared modules under src/, bots/ and vendor/ (which resolve packages from
# /app/node_modules) through one symlink.
COPY services/hq/package.json services/hq/package-lock.json services/hq/
RUN cd services/hq && npm ci --omit=dev --omit=peer --no-audit --no-fund && npm cache clean --force \
 && ln -s /app/services/hq/node_modules /app/node_modules

# The shared modules HQ imports, and HQ itself.
COPY src/lib/ src/lib/
COPY src/shims/ src/shims/
COPY vendor/executor/*.mjs vendor/executor/
COPY bots/lib/ bots/lib/
COPY bots/popcat/ bots/popcat/
COPY bots/cashcat/*.mjs bots/cashcat/
COPY services/hq/ services/hq/

# The database lives on the volume Railway mounts (RAILWAY_VOLUME_MOUNT_PATH, e.g. /data).
# Railway mounts volumes as root, so the process runs as the image's root user; the container
# is its only home, and every secret it holds arrives through the environment.
EXPOSE 8787
CMD ["node", "services/hq/server.mjs"]
