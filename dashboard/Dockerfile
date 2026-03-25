# syntax=docker/dockerfile:1
# ============================================
# Stage 1: Prune workspace for Docker
# ============================================
FROM node:24-slim AS prune
WORKDIR /app
COPY . .
RUN npx -y turbo@2 prune @vldr/api @vldr/web --docker

# ============================================
# Stage 2: Install dependencies
# ============================================
FROM node:24 AS deps
WORKDIR /app
# Copy pruned package.json files and lockfile
COPY --from=prune /app/out/json/ .
# Windows-generated lockfile lacks Linux optional deps — delete and install fresh
# Cache npm downloads between builds so reinstalls are fast
RUN --mount=type=cache,target=/root/.npm \
    rm -f package-lock.json && npm install

# ============================================
# Stage 3: Build all packages
# ============================================
FROM deps AS build
# Copy pruned source files (includes turbo.json)
COPY --from=prune /app/out/full/ .
# turbo prune doesn't track tsconfig extends — copy root tsconfig explicitly
COPY --from=prune /app/tsconfig.json ./tsconfig.json
RUN npx turbo build

# ============================================
# Stage 4: Production runner
# ============================================
FROM node:24-slim AS runner
WORKDIR /app

# Install curl for healthcheck, procps for concurrently process management
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl procps && \
    rm -rf /var/lib/apt/lists/*

# Create data directory for SQLite volume mount
RUN mkdir -p /app/data

# Copy root package.json and node_modules (includes hoisted native deps like better-sqlite3)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

# Copy built packages
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/package.json

# Copy Next.js standalone build
COPY --from=build /app/apps/web/.next/standalone ./standalone
# Copy static assets into standalone (not included by Next.js)
COPY --from=build /app/apps/web/.next/static ./standalone/apps/web/.next/static
# Copy public assets (sprites, etc.) into standalone — use prune stage which has full source
COPY --from=prune /app/apps/web/public ./standalone/apps/web/public

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000 3141

CMD ["npx", "concurrently", "--kill-others-on-fail", "--names", "api,web", "node packages/api/dist/index.js", "node standalone/apps/web/server.js"]
