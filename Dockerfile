# =============================================================================
# Plexus Command Center — Production/Staging Dockerfile
# Multi-stage build: compile TypeScript + bundle React, then run in slim image.
#
# The default container command runs the APPLICATION ONLY (node dist/index.cjs).
# Database schema changes are applied out-of-band by a dedicated one-shot ECS
# "migrate" task that overrides the command (see the MigrationTaskDef in
# infrastructure/lib/plexus-staging-stack.ts). Nothing mutates the schema on
# normal app startup.
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

# ---------------------------------------------------------------------------
# Amazon RDS global CA bundle.
# RDS Postgres presents an AWS-managed certificate. We install the official RDS
# global CA bundle and point Node at it via NODE_EXTRA_CA_CERTS so TLS is FULLY
# VERIFIED (rejectUnauthorized stays true). This is the secure alternative to
# NODE_TLS_REJECT_UNAUTHORIZED=0 / sslmode=no-verify, which we do NOT use.
# ---------------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
         -o /etc/ssl/certs/rds-global-bundle.pem \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

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

# -----------------------------------------------------------------------------
# Default command: run the APPLICATION ONLY.
#
# Schema changes are NOT applied here. Running `drizzle-kit push` on every
# container start is destructive and races across rolling ECS tasks. Migrations
# run exactly once via the dedicated one-shot ECS "migrate" task definition,
# which overrides this command with:
#     sh -c "HOME=/app/tmp npx drizzle-kit push"
# (see infrastructure/lib/plexus-staging-stack.ts -> MigrationTaskDef).
# -----------------------------------------------------------------------------
ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
