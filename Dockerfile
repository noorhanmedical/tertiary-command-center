# =============================================================================
# Plexus Command Center — Production Dockerfile
# Multi-stage build: compile TypeScript + bundle React, then run in slim image.
# =============================================================================

# --- Stage 1: Build -----------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies first (layer cached unless package*.json changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build (Vite frontend + esbuild server → dist/)
COPY . .
RUN npm run build

# --- Stage 2: Production image ------------------------------------------------
FROM node:20-slim AS production
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# The app listens on port 5000
EXPOSE 5000

# Health check for ECS (matches DEPLOY_AWS.md spec)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:5000/healthz',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

# Run as non-root for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

# Start the production server
ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
