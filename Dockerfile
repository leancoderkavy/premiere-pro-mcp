# ── Stage 1: Build MCP server (TypeScript → dist/) ───────────────────────────
FROM node:20-alpine AS mcp-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Build Next.js landing page (→ landing/.next/out/) ───────────────
FROM node:20-alpine AS landing-builder

WORKDIR /landing

COPY landing/package*.json ./
RUN npm ci

COPY landing/ ./

RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=mcp-builder /app/dist ./dist

# Copy Next.js static export to landing-dist (referenced in http-server.ts)
COPY --from=landing-builder /landing/out ./landing-dist

EXPOSE 3000

CMD ["node", "dist/http-server.js"]
