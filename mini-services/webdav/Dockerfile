# Doma Cloud — WebDAV mini-service Dockerfile.
#
# Multi-stage build that bakes dependencies into the image and runs as a
# non-root user. The previous setup used `oven/bun:1-slim` directly with a
# bind-mounted source directory and ran `bun install` on every container
# start — which (a) ran as root, (b) required network access on startup,
# (c) wrote node_modules into the host filesystem, and (d) was slow.

# ---- Stage 1: deps ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# ---- Stage 2: runtime ----
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user — matches the UID/GID used by the main `doma` service so
# both containers can read/write the same mounted storage volume.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy application source and baked node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs . .

# Database + storage mount points (chowned so the non-root user can write).
RUN mkdir -p /app/db /data/doma-storage \
 && chown -R nextjs:nodejs /app /data

USER nextjs
EXPOSE 3001

CMD ["bun", "run", "index.ts"]
