# Doma Cloud — production Dockerfile.
# Multi-stage build producing a minimal standalone Next.js server.

# ---- Stage 1: deps ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ---- Stage 2: build ----
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---- Stage 3: runtime ----
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for safety.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy the standalone server output.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# Native modules used at runtime — standalone output doesn't always include
# them automatically. @node-rs/argon2 has prebuilt .node binaries that must
# be present for password hashing to work.
COPY --from=builder /app/node_modules/@node-rs ./node_modules/@node-rs
# AWS SDK — used when STORAGE_DRIVER=s3. serverExternalPackages keeps it
# out of the Next.js bundle, so we must copy it explicitly. Without this,
# switching to S3 storage crashes with MODULE_NOT_FOUND on the first upload.
COPY --from=builder /app/node_modules/@aws-sdk ./node_modules/@aws-sdk
# sharp — used for on-the-fly thumbnail generation in /api/files/thumbnail.
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp

# Database directory (mounted as a volume).
RUN mkdir -p /app/db /data/doma-storage \
 && chown -R nextjs:nodejs /app /data

USER nextjs
EXPOSE 3000

# Apply DB schema on startup only if the DB is empty (first boot), then start
# the server. Running `prisma db push` on every restart is slow and risky
# (it can require --accept-data-loss if the schema diverges). On subsequent
# boots the DB is already in sync — no migration needed.
CMD ["sh", "-c", "if [ ! -f /app/db/doma.db ]; then bunx prisma db push --skip-generate; fi && node server.js"]
