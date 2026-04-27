FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY services/ws-gateway/package.json services/ws-gateway/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY services/ws-gateway services/ws-gateway
RUN pnpm --filter @ridex/ws-gateway build

FROM node:20-alpine AS runtime
WORKDIR /app/services/ws-gateway
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/ws-gateway/dist         dist
COPY --from=build /app/services/ws-gateway/package.json package.json
EXPOSE 3100
CMD ["node", "dist/index.js"]
