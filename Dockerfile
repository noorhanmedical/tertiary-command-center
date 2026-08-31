# =============================================================================
# Plexus Command Center — Production Dockerfile
# Multi-stage build: compile TypeScript + bundle React, then run in slim image.
# Runs database migrations at startup before launching the app.
# =============================================================================

# --- Stage 1: Build -----------------------------------------------------------
FROM --platform=linux/amd64 node:20-slim AS builder
WORKDIR /app

# Install dependencies first (layer cached unless package*.json changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build (Vite frontend + esbuild server → dist/)
COPY . .
RUN npm run build

# --- Stage 2: Production image ------------------------------------------------
FROM --platform=linux/amd64 node:20-slim AS production
WORKDIR /app

# Install ALL dependencies (need drizzle-kit for migrations)
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Copy migration-related files (drizzle needs schema + config)
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy migration SQL files if they exist
COPY --from=builder /app/migrations ./migrations

# Copy backfill scripts
COPY --from=builder /app/scripts ./scripts

# Copy seed/operational scripts (singular `script/` — includes the
# investor-demo seed run as a one-shot ECS task; see DEMO_INVESTOR.md).
COPY --from=builder /app/script ./script

# The app listens on port 5000
EXPOSE 5000

# Health check for ECS
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:5000/healthz',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

# Run as non-root for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Create writable directories for local file operations
RUN mkdir -p /app/storage /app/tmp && chown -R appuser:appgroup /app/storage /app/tmp

USER appuser

# Start: run migrations then launch app
ENV NODE_ENV=production
CMD ["sh", "-c", "HOME=/app/tmp npx drizzle-kit push --force && node dist/index.cjs"]
