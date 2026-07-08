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

# Database directory (mounted as a volume).
RUN mkdir -p /app/db /data/doma-storage \
 && chown -R nextjs:nodejs /app /data

USER nextjs
EXPOSE 3000

# Apply DB schema on startup, then start the server.
CMD ["sh", "-c", "bunx prisma db push --skip-generate && node server.js"]
