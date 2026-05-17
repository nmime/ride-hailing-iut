FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY libs/service-utils/package.json libs/service-utils/
COPY services/ingestor/package.json services/ingestor/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY libs/service-utils libs/service-utils
COPY services/ingestor services/ingestor
RUN pnpm --filter @ridex/service-utils build && \
    pnpm --filter @ridex/ingestor build

FROM node:20-alpine AS runtime
WORKDIR /app/services/ingestor
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/libs/service-utils /app/libs/service-utils
COPY --from=build /app/services/ingestor/node_modules node_modules
COPY --from=build /app/services/ingestor/dist         dist
COPY --from=build /app/services/ingestor/package.json package.json
EXPOSE 3200
CMD ["node", "dist/index.js"]
