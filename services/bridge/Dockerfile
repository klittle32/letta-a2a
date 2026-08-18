FROM oven/bun:1.3.14 AS build

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
