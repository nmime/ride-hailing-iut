FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
ARG VITE_MAP_PROVIDER=auto
ARG VITE_YANDEX_MAPS_API_KEY=
ARG VITE_YANDEX_MAPS_LANG=en_US
ARG VITE_DEMO_PASSWORD=
ARG VITE_RIDEX_DEMO_PASSWORD=
ENV VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER
ENV VITE_YANDEX_MAPS_API_KEY=$VITE_YANDEX_MAPS_API_KEY
ENV VITE_YANDEX_MAPS_LANG=$VITE_YANDEX_MAPS_LANG
ENV VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD
ENV VITE_RIDEX_DEMO_PASSWORD=$VITE_RIDEX_DEMO_PASSWORD
COPY apps/web apps/web
RUN pnpm --filter @ridex/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
