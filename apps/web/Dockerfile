FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY apps/web apps/web
RUN pnpm --filter @ridex/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
