# Stage 1: Install dependencies (dev + prod for build)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --filter sifter-worker...

# Stage 2: Build TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/worker/node_modules ./worker/node_modules
COPY packages/core ./packages/core
COPY worker ./worker
RUN cd packages/core && node_modules/.bin/tsc
RUN cd worker && node_modules/.bin/tsc

# Stage 3: Production image
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter sifter-worker...
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/worker/dist ./worker/dist
WORKDIR /app/worker
CMD ["node", "dist/index.js"]
