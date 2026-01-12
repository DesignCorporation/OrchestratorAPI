FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/orchestrator-worker/package.json services/orchestrator-worker/
COPY packages/orchestrator-core/package.json packages/orchestrator-core/
COPY packages/orchestrator-connectors/package.json packages/orchestrator-connectors/
RUN pnpm install --prod --no-frozen-lockfile

FROM base AS build
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/orchestrator-worker/package.json services/orchestrator-worker/
COPY packages/orchestrator-core/package.json packages/orchestrator-core/
COPY packages/orchestrator-connectors/package.json packages/orchestrator-connectors/
COPY services/orchestrator-worker services/orchestrator-worker
COPY packages packages
RUN pnpm install --no-frozen-lockfile --config.optional=true --config.node-linker=hoisted
RUN pnpm -C services/orchestrator-worker build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/orchestrator-worker/dist /app/services/orchestrator-worker/dist
COPY --from=build /app/services/orchestrator-worker/package.json /app/services/orchestrator-worker/package.json
ENV NODE_ENV=production
USER app
WORKDIR /app/services/orchestrator-worker
CMD ["node", "dist/index.js"]
