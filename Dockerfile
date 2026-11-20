# syntax=docker/dockerfile:1

# ---------- stage 1: build (all dependencies, compiles the client) ----------
FROM node:24-alpine AS build
WORKDIR /app
# package manifests first: this layer (npm install) is cached until a dependency changes
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
COPY server server
RUN npm run build -w client

# ---------- stage 2: runtime (production deps only, no compilers, not root) ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN (if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --no-audit --no-fund; fi) \
    && npm cache clean --force
# the server runs its TypeScript directly (Node's type stripping) — no build step, only sources
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/server/src server/src
COPY --from=build /app/client/dist client/dist

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA \
    PORT=3000 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/client/dist \
    LOG_DIR=/tmp/logs

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# exec form: node is PID 1's child of nothing — it receives SIGTERM directly (npm start would swallow it)
CMD ["node", "server/src/index.ts"]
