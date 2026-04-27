# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps/api/package.json apps/api/
COPY libs/consistent-hash/package.json libs/consistent-hash/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY apps/api      apps/api
COPY libs/consistent-hash libs/consistent-hash
RUN pnpm --filter @ridex/consistent-hash build && \
    pnpm --filter @ridex/api          build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
ENV NODE_ENV=production
COPY --from=build /app/node_modules                       node_modules
COPY --from=build /app/libs/consistent-hash               libs/consistent-hash
COPY --from=build /app/apps/api/dist                      apps/api/dist
COPY --from=build /app/apps/api/package.json              apps/api/package.json
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
# Pre-load OpenTelemetry SDK so traces wrap every incoming request
CMD ["node", "--require", "./dist/otel.js", "dist/main.js"]
