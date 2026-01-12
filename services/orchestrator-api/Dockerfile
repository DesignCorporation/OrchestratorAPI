FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/orchestrator-api/package.json services/orchestrator-api/
COPY packages/orchestrator-core/package.json packages/orchestrator-core/
COPY packages/orchestrator-connectors/package.json packages/orchestrator-connectors/
RUN pnpm install --prod --no-frozen-lockfile

FROM base AS build
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/orchestrator-api/package.json services/orchestrator-api/
COPY packages/orchestrator-core/package.json packages/orchestrator-core/
COPY packages/orchestrator-connectors/package.json packages/orchestrator-connectors/
COPY services/orchestrator-api services/orchestrator-api
COPY packages packages
RUN pnpm install --no-frozen-lockfile --config.optional=true --config.node-linker=hoisted
RUN pnpm -C services/orchestrator-api build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/orchestrator-api/dist /app/services/orchestrator-api/dist
COPY --from=build /app/services/orchestrator-api/package.json /app/services/orchestrator-api/package.json
ENV NODE_ENV=production
USER app
WORKDIR /app/services/orchestrator-api
EXPOSE 3000
CMD ["node", "dist/index.js"]
