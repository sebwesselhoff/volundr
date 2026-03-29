---
name: "Docker Containerization"
description: "Dockerfile best practices, multi-stage builds, layer caching, and compose patterns"
domain: "infra"
confidence: "high"
source: "seed"
version: 1
validatedAt: "2026-03-26"
reviewByDate: "2026-09-26"
triggers:
  - "docker"
  - "dockerfile"
  - "container"
  - "compose"
  - "image"
  - "build"
  - "layer cache"
roles:
  - "developer"
  - "devops-engineer"
---

## Context
Apply when writing Dockerfiles, docker-compose files, or CI/CD container build steps. Good container
practices reduce build times, image sizes, and surface area for security issues.

## Patterns

**Multi-stage builds — separate build from runtime:**
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

**Layer cache ordering — stable layers first:**
1. Base image
2. `package.json` + lockfile (changes rarely)
3. `npm ci`
4. Source files (changes often)

**Non-root user in production images:**
```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

**`.dockerignore` — exclude build noise:**
```
node_modules
.git
*.log
dist
```

**Pinned base image versions** — use `node:22.11-alpine` not `node:latest`.

## Examples

```yaml
# docker-compose.yml — dev with hot reload
services:
  api:
    build: .
    volumes:
      - ./src:/app/src
    environment:
      NODE_ENV: development
    ports:
      - "3141:3141"
```

## Anti-Patterns

- **`COPY . .` before installing dependencies** — invalidates the npm install cache on every code change
- **Running as root** — unnecessary privilege escalation
- **`latest` tag** — non-deterministic builds
- **Secrets in ENV or image layers** — use Docker secrets or runtime injection
- **Large final images** — multi-stage builds keep runtimes small
