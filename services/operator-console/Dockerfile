FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/operator-console/package.json services/operator-console/
RUN pnpm install --prod --no-frozen-lockfile

FROM base AS build
COPY package.json pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY services/operator-console/package.json services/operator-console/
COPY services/operator-console services/operator-console
RUN pnpm install --no-frozen-lockfile --config.optional=true --config.node-linker=hoisted
RUN pnpm -C services/operator-console build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/operator-console/dist /app/services/operator-console/dist
COPY --from=build /app/services/operator-console/package.json /app/services/operator-console/package.json
COPY --from=build /app/services/operator-console/public /app/services/operator-console/public
ENV NODE_ENV=production
USER app
WORKDIR /app/services/operator-console
EXPOSE 3002
CMD ["node", "dist/index.js"]
