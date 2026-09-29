# ── Stage 1: Build MCP server (TypeScript → dist/) ───────────────────────────
FROM node:20-alpine AS mcp-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/copy-adobe-uxp-coverage.mjs ./scripts/copy-adobe-uxp-coverage.mjs
COPY scripts/generate-adobe-api-inventory.mjs ./scripts/generate-adobe-api-inventory.mjs
COPY scripts/generate-uxp-js-api-inventory.mjs ./scripts/generate-uxp-js-api-inventory.mjs

RUN npm run build

# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF

ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=mcp-builder /app/dist ./dist

# Keep the editor control plane and media subprocesses unprivileged. Runtime
# bridge files use this user's private temp directory; context lives in HOME.
RUN mkdir -p /home/node/.local/state/premiere-pro-mcp/context \
    && chown -R node:node /home/node/.local \
    && chmod 700 /home/node/.local/state/premiere-pro-mcp/context
USER node

EXPOSE 3000

CMD ["node", "dist/http-server.js"]
