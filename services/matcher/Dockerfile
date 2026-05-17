# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY services/matcher/package.json services/matcher/
COPY libs/consistent-hash/package.json libs/consistent-hash/
COPY libs/service-utils/package.json libs/service-utils/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY services/matcher services/matcher
COPY libs/consistent-hash libs/consistent-hash
COPY libs/service-utils libs/service-utils
RUN pnpm --filter @ridex/consistent-hash build && \
    pnpm --filter @ridex/service-utils   build && \
    pnpm --filter @ridex/matcher          build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules                node_modules
COPY --from=build /app/services/matcher/node_modules services/matcher/node_modules
COPY --from=build /app/libs/consistent-hash        libs/consistent-hash
COPY --from=build /app/libs/service-utils           libs/service-utils
COPY --from=build /app/services/matcher/dist       services/matcher/dist
COPY --from=build /app/services/matcher/package.json services/matcher/
WORKDIR /app/services/matcher
CMD ["node", "dist/index.js"]
