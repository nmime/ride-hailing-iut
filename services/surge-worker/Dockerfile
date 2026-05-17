FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY libs/service-utils/package.json libs/service-utils/
COPY services/surge-worker/package.json services/surge-worker/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY libs/service-utils libs/service-utils
COPY services/surge-worker services/surge-worker
RUN pnpm --filter @ridex/service-utils build && \
    pnpm --filter @ridex/surge-worker build

FROM node:20-alpine AS runtime
WORKDIR /app/services/surge-worker
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/libs/service-utils /app/libs/service-utils
COPY --from=build /app/services/surge-worker/node_modules node_modules
COPY --from=build /app/services/surge-worker/dist         dist
COPY --from=build /app/services/surge-worker/package.json package.json
CMD ["node", "dist/index.js"]
