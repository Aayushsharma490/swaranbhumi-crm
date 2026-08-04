FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests for caching
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/backend/package*.json ./apps/backend/

# Install dependencies (workspaces handle linking)
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Generate Prisma Client and Build
RUN npm run build:shared
RUN npm install --workspace=apps/backend @prisma/client@6.0.0 --no-save
RUN cd apps/backend && npx prisma generate
RUN npm run build:backend

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

# Install openssl for Prisma compatibility on Alpine
RUN apk add --no-cache openssl

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "apps/backend/dist/server.js"]
