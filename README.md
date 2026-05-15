# RideX

RideX is a full-stack ride-hailing mini-platform built for the **Database
Application and Design** group project at Inha University in Tashkent, Spring
2026.

The application covers the selected business scenario from the project
specification: **driver/rider matching, live location streaming, trip history,
and surge pricing**. It runs as a Docker Compose stack behind an Nginx gateway
and combines REST, WebSockets, Postgres/PostGIS, Redis, Redpanda, batch jobs,
stream processing, and a Grafana observability stack.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Demo Accounts](#demo-accounts)
- [Useful URLs](#useful-urls)
- [Development Commands](#development-commands)
- [Smoke Test](#smoke-test)
- [Environment Variables](#environment-variables)
- [Repository Layout](#repository-layout)
- [Project Requirement Coverage](#project-requirement-coverage)
- [Documentation](#documentation)
- [Contributing and Change Guide](#contributing-and-change-guide)
- [Submission Checklist](#submission-checklist)

## Features

- Rider signup/login and ride request flow.
- Driver login, online/offline status, vehicle management, and location ingest.
- Automatic rider/driver matching using Redis GEO and a matcher service.
- Live trip updates over Socket.IO WebSockets.
- Trip lifecycle: requested, matched, in progress, completed, cancelled.
- Trip history and rider rating after completion.
- Surge pricing driven by stream-processing demand/supply windows.
- Admin dashboard for daily driver reports and surge zones.
- Swagger/OpenAPI documentation for the REST API.
- Rate limiting with a from-scratch token-bucket implementation.
- Consistent-hashing ring implemented from scratch and integrated into matcher
  replica ownership.
- Centralized traces, logs, and metrics with OpenTelemetry, Prometheus, Loki,
  Tempo, and Grafana.

## Architecture

```text
Browser clients
  |-- /             -> React/Vite web app
  |-- /api/*        -> NestJS API replicas
  |-- /ws/*         -> Socket.IO WebSocket gateway
  |-- /ingest/*     -> driver-location ingestor
  v
Nginx gateway (:80, optional :443 in production)
  |
  +-- api x2              -> Postgres/PostGIS, Redis, Redpanda
  +-- ws-gateway          -> Redpanda event fan-out to WebSocket rooms
  +-- ingestor            -> driver.location.v1 stream + Redis GEO index
  +-- matcher-0/1         -> consumes trip/location events and assigns drivers
  +-- surge-worker        -> computes zone surge multipliers
  +-- cron                -> refreshes materialized views and exports reports
  +-- observability stack -> OTel Collector, Prometheus, Loki, Tempo, Grafana
```

The full architecture diagrams, data-flow diagrams, dependency graph, and BPMN
workflow diagrams are maintained in `docs/architecture.md` and `docs/bpmn/`.

## Tech Stack

| Area | Implementation |
|---|---|
| Frontend | React 18, Vite, React Router, Leaflet / optional Yandex Maps |
| REST API | NestJS 10, Fastify adapter, Swagger/OpenAPI |
| Realtime API | Socket.IO WebSockets |
| Relational data | Postgres 16 with PostGIS |
| Polyglot stores | Redis for live GEO/cache/rate-limit state, Redpanda for streams |
| Gateway | Nginx reverse proxy and API load balancer |
| Stream pipeline | Redpanda topics: `driver.location.v1`, `trip.events.v1` |
| Batch pipeline | Node cron worker refreshing reports and exports |
| Observability | OpenTelemetry, Prometheus, Promtail, Loki, Tempo, Grafana |
| Monorepo | pnpm workspaces, TypeScript |

## Quick Start

Prerequisites:

- Docker and Docker Compose
- Node.js 20+
- pnpm 9+

Create the environment file, set secrets, and start the complete stack:

```bash
cp .env.example .env
# The example values are runnable locally. Replace secrets before production.

pnpm bootstrap
```

`pnpm bootstrap` runs `docker compose up -d --build`, applies migrations, and
loads the seed data. The underlying commands are also available separately as
`pnpm compose:up`, `pnpm db:migrate`, and `pnpm db:seed`.

The stack exposes one public application port through the gateway:

```bash
open http://localhost
open http://localhost/api/docs
open http://localhost/grafana/
```

If your Docker Compose version ignores `deploy.replicas` outside Swarm, start
the API replicas explicitly:

```bash
docker compose up -d --scale api=2 --build
```

To reset the stack while keeping source files untouched:

```bash
docker compose down
docker volume rm ridex_pgdata ridex_redisdata ridex_rpdata
docker compose up -d --build
docker compose exec api node dist/scripts/migrate.js
docker compose exec api node dist/scripts/seed.js
```

## Demo Accounts

Seeded users use `RIDEX_SEED_PASSWORD` from `.env`.

| Role | Phone |
|---|---|
| Admin | `+998900000000` |
| Rider | `+998901111111` |
| Driver | `+998903333333` |

## Useful URLs

| URL | Purpose |
|---|---|
| `http://localhost` | React application through Nginx |
| `http://localhost/api/docs` | Swagger UI |
| `http://localhost/api/healthz` | API liveness check |
| `http://localhost/api/readyz` | API readiness check with Postgres and Redis |
| `http://localhost/api/metrics` | Prometheus metrics from the API |
| `http://localhost/grafana/` | Grafana, default user from `.env` |

All internal services stay on the `ridex` Docker network. Client traffic enters
through the gateway.

## Development Commands

Root workspace commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm compose:up
pnpm db:migrate
pnpm db:seed
pnpm db:setup
pnpm bootstrap
pnpm compose:down
```

Targeted examples:

```bash
pnpm --filter @ridex/api test
pnpm --filter @ridex/web test
pnpm --filter @ridex/consistent-hash test
pnpm --filter @ridex/ratelimiter test
```

The Docker path is the canonical way to run the full distributed system because
the API, workers, gateway, Postgres, Redis, Redpanda, and observability services
depend on each other.

## Validation Snapshot

The workspace currently defines focused automated checks across the web app,
API DTO validation, consistent-hash ring, and rate-limiter packages. Run
`pnpm test` from the repository root after installing dependencies.

## Smoke Test

After the stack is running and seeded:

```bash
while IFS='=' read -r key value; do
  case "$key" in
    RIDEX_SEED_PASSWORD|RIDEX_SMOKE_*) export "$key=$value" ;;
  esac
done < .env
bash scripts/smoke.sh http://localhost
```

The smoke test checks:

- gateway health;
- Swagger reachability;
- seeded rider, driver, and admin login;
- driver online status and location ingest;
- trip creation and matcher assignment;
- trip start/completion;
- rider rating;
- admin daily report access.

## Environment Variables

See `.env.example` for the complete reference. The most important variables are:

| Variable | Purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres credentials and database name |
| `DATABASE_URL` | Optional explicit Postgres connection string |
| `REDIS_URL` | Redis connection used for GEO, cache, and rate limits |
| `KAFKA_BROKERS` | Redpanda/Kafka bootstrap servers |
| `TOPIC_DRIVER_LOCATION` | Driver location stream topic |
| `TOPIC_TRIP_EVENTS` | Trip lifecycle event stream topic |
| `API_PORT`, `API_HOST` | API listen configuration |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Authentication signing settings |
| `RIDEX_SEED_PASSWORD` | Password assigned to seeded demo users |
| `WS_PORT`, `WS_CORS_ORIGINS` | WebSocket gateway settings |
| `MATCHER_REPLICA_IDS`, `MATCHER_RING_VNODES` | Consistent-hash matcher ownership configuration |
| `INGESTOR_PORT`, `INGESTOR_HOST` | Driver-location ingest service settings |
| `VITE_API_BASE`, `VITE_WS_BASE`, `VITE_INGEST_BASE` | Frontend gateway paths |
| `VITE_MAP_PROVIDER` | `auto`, `yandex`, or tile fallback |
| `VITE_YANDEX_MAPS_API_KEY`, `VITE_YANDEX_MAPS_LANG` | Optional Yandex Maps browser integration |
| `RATELIMIT_AUTH_*`, `RATELIMIT_USER_*` | Token-bucket rate-limit settings |
| `SURGE_*` | Surge worker thresholds, max multiplier, and windows |
| `CRON_*`, `EXPORTS_DIR` | Batch worker schedules and export directory |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | OpenTelemetry export settings |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_ROOT_URL` | Grafana login and gateway subpath URL |

Do not commit `.env`; use `.env.example` for shared defaults.

## Repository Layout

```text
.
├── apps/
│   ├── api/                  # NestJS + Fastify REST API
│   └── web/                  # React + Vite frontend
├── services/
│   ├── cron/                 # batch reports and exports
│   ├── ingestor/             # driver location ingest API
│   ├── matcher/              # rider/driver matching worker
│   ├── surge-worker/         # surge multiplier stream worker
│   └── ws-gateway/           # Socket.IO event gateway
├── libs/
│   ├── consistent-hash/      # from-scratch consistent-hashing ring
│   └── ratelimiter/          # from-scratch token-bucket rate limiter
├── db/
│   ├── migrations/           # SQL migrations
│   └── seed/                 # demo and load-test seed data
├── docs/
│   ├── api-endpoints.md      # REST endpoint reference
│   ├── architecture.md       # system diagrams and data flows
│   ├── optimisation.md       # cache/index measurements
│   ├── report-draft.md       # report source
│   └── bpmn/                 # BPMN workflow diagrams
├── infra/
│   ├── grafana/              # dashboards and datasources
│   ├── nginx/                # gateway configuration
│   └── otel/                 # collector, Prometheus, Promtail, Tempo config
├── load/                     # k6 load-test scripts
├── scripts/                  # smoke test and utility scripts
├── docker-compose.yml
├── CHANGELOG.md
├── LINKS.txt
└── README.md
```

## Project Requirement Coverage

| Requirement | Where it is implemented or documented |
|---|---|
| R1 Business scenario and requirements | `docs/report-draft.md`; RideX scenario is ride-hailing with rider, driver, admin actors |
| R2 Data model and architecture diagrams | `docs/architecture.md`, `docs/bpmn/`, SQL schema in `db/migrations/` |
| R3 Relational DBMS implementation | Postgres/PostGIS in `docker-compose.yml`; migrations in `db/migrations/`; seeds in `db/seed/` |
| R4 RESTful API and backend framework | NestJS/Fastify in `apps/api/`; Swagger at `/api/docs`; endpoint reference in `docs/api-endpoints.md` |
| R5 Polyglot persistence | Redis GEO/cache/rate-limit state, Redpanda streams, PostGIS spatial queries |
| R6 Cache, indexing, and storage optimisation | Redis GEO, surge cache, materialized views, GIN/GIST indexes; measurements in `docs/optimisation.md` |
| R7 Additional API style | Socket.IO WebSockets in `services/ws-gateway/` and `apps/web/src/hooks/useTripSocket.ts` |
| R8 API gateway and load balancing | Nginx config in `infra/nginx/`; two API replicas via Compose |
| R9 Docker Compose orchestration | `docker-compose.yml` with health checks, named volumes, and one public gateway port |
| R10 Batch or stream pipeline | Redpanda stream workers, cron batch worker, BPMN files in `docs/bpmn/` |
| R11 From-scratch system component | `libs/consistent-hash/` and `libs/ratelimiter/`, both integrated into runtime services |
| R12 Observability | OTel collector, Prometheus, Promtail, Loki, Tempo, Grafana configs in `infra/`; `/api/metrics` |
| R13 Documentation | This README, `docs/api-endpoints.md`, Swagger UI, `CHANGELOG.md` |

## Documentation

- `docs/architecture.md` explains services, data stores, compose dependencies,
  and ride lifecycle data flow.
- `docs/api-endpoints.md` documents REST endpoints, schemas, errors, and rate
  limits.
- `docs/optimisation.md` records cache/index/materialized-view measurements.
- `docs/bpmn/README.md` explains the BPMN workflow files.
- `libs/consistent-hash/README.md` explains the matcher sharding component.
- `libs/ratelimiter/README.md` explains the token-bucket rate limiter.
- `CHANGELOG.md` tracks release notes.
- `LINKS.txt` is reserved for the deployed URL, GitHub URL, and team roster.

## Contributing and Change Guide

1. Branch from `main` for every feature or fix.
2. Keep changes scoped to the relevant app, service, library, or doc.
3. Run the affected tests before opening a pull request.
4. Run `pnpm lint` and `pnpm test` before merging broad changes.
5. Update migrations and seed data together when schema changes.
6. Update `docs/api-endpoints.md` and Swagger decorators when API behavior
   changes.
7. Update `docs/architecture.md` or BPMN files when service topology or
   workflow logic changes.
8. Add an entry to `CHANGELOG.md` for user-visible or submission-relevant
   changes.
9. Use each contributor's own GitHub account for commits; the project
   specification grades commit history and contribution balance.

## Submission Checklist

- The stack starts with `docker compose up -d --build`.
- Migrations and seed scripts run successfully from a clean database.
- `http://localhost` serves the web app through Nginx.
- `http://localhost/api/docs` serves live Swagger documentation.
- `bash scripts/smoke.sh http://localhost` passes.
- Grafana at `http://localhost/grafana/` shows traces, logs, and metrics after a
  user action.
- `LINKS.txt` contains deployed URL, GitHub URL, and full team roster.
- The final GitHub version is tagged `v1.0`.
- The submitted zip contains `report.pdf` and `LINKS.txt`.

## License

Course project repository. Add an explicit license before distributing this code
outside the project team.
