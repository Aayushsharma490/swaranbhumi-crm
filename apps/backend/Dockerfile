FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for Prisma on Alpine
RUN apk add --no-cache openssl

# Copy all package manifests first (for layer caching)
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/backend/package*.json ./apps/backend/

# Install ALL dependencies (dev + prod) so we can build
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Build shared package
RUN npm run build:shared

# Generate Prisma Client (install prisma first, then generate)
RUN npm install --workspace=apps/backend @prisma/client@6.0.0 --no-save
RUN cd apps/backend && npm exec --package=prisma@6.0.0 -- prisma generate --schema=prisma/schema.prisma

# Build backend TypeScript
RUN npm run build:backend

# ─── Production image ───────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install openssl for Prisma runtime on Alpine
RUN apk add --no-cache openssl

# Copy package manifests
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/apps/backend/package*.json ./apps/backend/

# Install PRODUCTION dependencies directly in runner (no copying node_modules)
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma

# Copy Prisma generated client (platform-specific binaries)
COPY --from=builder /app/apps/backend/node_modules/.prisma ./apps/backend/node_modules/.prisma
COPY --from=builder /app/apps/backend/node_modules/@prisma/client ./apps/backend/node_modules/@prisma/client

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "apps/backend/dist/server.js"]
