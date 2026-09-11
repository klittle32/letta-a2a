FROM oven/bun:1.4.2 AS build

# Build the pinned local packages before resolving root file dependencies.
WORKDIR /app/packages/letta-a2a-bridge
COPY packages/letta-a2a-bridge/package.json packages/letta-a2a-bridge/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/letta-a2a-bridge/tsconfig.json ./
COPY packages/letta-a2a-bridge/src ./src
RUN bun run build

WORKDIR /app/packages/letta-a2a-client
COPY packages/letta-a2a-client/package.json packages/letta-a2a-client/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/letta-a2a-client/tsconfig.json packages/letta-a2a-client/tsconfig.build.json ./
COPY packages/letta-a2a-client/src ./src
COPY packages/letta-a2a-client/mods ./mods
RUN bun run build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY services ./services
RUN bun run build

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/services/bridge ./dist/services/bridge

EXPOSE 8080
CMD ["node", "dist/services/bridge/src/index.js"]
