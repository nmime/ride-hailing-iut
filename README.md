# RideX — Ride-Hailing Mini-Platform

Group project for **Database Application & Design** (Spring 2026, Inha University in Tashkent).
Team leader submission only — see `LINKS.txt` for the deployed URL, GitHub URL, and team roster.

> **Status:** working project baseline. The backend code is intentionally compact so the team can
> explain the data model, event flow, and service responsibilities line by line in viva.

---

## What this is

A full-stack distributed ride-hailing platform: riders request rides, drivers accept and stream
their location, the matcher service pairs them by geographic proximity, and an admin sees the live
fleet. The system is built around three data stores (Postgres + PostGIS, Redis, Redpanda),
two API styles (REST + WebSocket), and an Nginx gateway with two backend replicas behind it.

| Capability | Implementation |
|---|---|
| Relational store | Postgres 16 with PostGIS |
| Polyglot store(s) | Redis (live driver index, surge cache), PostGIS (spatial queries) |
| Stream | Redpanda (Kafka-API compatible) for `driver.location` and `trip.events` topics |
| REST API | NestJS + Fastify, OpenAPI / Swagger UI at `/docs` |
| Non-REST API | WebSocket (Socket.IO) for live trip updates, matched-driver tracking, geographic surge feed |
| Gateway / LB | Nginx with two `api` replicas |
| Batch pipeline | Nightly trip-aggregate job (cron + Node task runner) |
| Stream pipeline | Surge multiplier computed off the location stream |
| From-scratch | Consistent-hashing ring used by `matcher` to shard drivers across workers |
| Observability | OpenTelemetry → Tempo (traces), Loki (logs), Prometheus (metrics), Grafana |

---

## One-command bring-up

```bash
cp .env.example .env          # edit secrets if needed
docker compose up -d --build
docker compose exec api node dist/scripts/migrate.js
docker compose exec api node dist/scripts/seed.js
open http://localhost            # gateway → web app
open http://localhost/api/docs   # Swagger UI
open http://localhost:3001       # Grafana (admin / admin)
```

To render the in-app maps with Yandex Maps instead of the OpenStreetMap fallback, set these before
building the web image:

```bash
VITE_MAP_PROVIDER=yandex
VITE_YANDEX_MAPS_API_KEY=your_browser_key
VITE_YANDEX_MAPS_LANG=en_US
docker compose up -d --build web gateway
```

Yandex route links are available in the rider and driver screens even when the embedded provider
falls back to OpenStreetMap.

Seeded app users all use `RIDEX_SEED_PASSWORD` (default `ChangeMe123!`):

| Role | Phone |
|---|---|
| Admin | `+998900000000` |
| Rider | `+998901111111` |
| Driver | `+998903333333` |

> **Note on api scaling.** The compose file uses `deploy.replicas: 2` for
> `api`. If your Docker Compose version ignores `deploy.replicas` outside
> Swarm, run `docker compose up -d --scale api=2 --build` instead, or
> declare two named services (as we did with `matcher-0` / `matcher-1`).
> The Nginx upstream uses `resolve` so it round-robins as soon as Docker
> DNS returns multiple A records.

The whole stack boots behind a single public port (`80`/`443`). All stateful services use named
volumes so data survives `docker compose down`.

## Smoke test

```bash
curl -fsS http://localhost/api/healthz
# expects: {"status":"ok"}

# after migrations + seed, run the end-to-end smoke flow
# Required env vars: RIDEX_SEED_PASSWORD, RIDEX_SMOKE_RIDER_PHONE,
# RIDEX_SMOKE_DRIVER_PHONE, RIDEX_SMOKE_ADMIN_PHONE, RIDEX_SMOKE_DRIVER_ID
bash scripts/smoke.sh http://localhost
```

The smoke script checks gateway health, API readiness (`/api/readyz`), Swagger reachability,
seeded-user login, driver location ingest, matching, trip start/complete, rider rating, and
admin reports. After a match, the rider UI subscribes to the matched driver and renders live
`driver:location` pins when pings arrive.

## Repository layout

```
ride-hailing/
├── apps/
│   ├── api/            # NestJS + Fastify REST API + Swagger
│   └── web/            # React + Vite frontend (rider, driver, admin)
├── services/
│   ├── matcher/        # consumes location stream, matches drivers ↔ riders
│   ├── ws-gateway/     # Socket.IO server for live updates
│   └── ingestor/       # accepts driver pings → publishes to Redpanda
├── libs/
│   └── consistent-hash/ # FROM-SCRATCH (R11) — used by matcher
├── db/
│   ├── migrations/     # versioned SQL migrations
│   └── seed/           # seed data for demos and load tests
├── infra/
│   ├── nginx/          # API gateway + load balancer
│   ├── otel/           # OpenTelemetry Collector config
│   └── grafana/        # provisioned dashboards
├── docs/
│   ├── api-endpoints.md
│   ├── architecture.md
│   ├── report-draft.md  # source of the PDF report
│   └── bpmn/            # BPMN diagrams for R10
├── docker-compose.yml
├── .env.example
└── CHANGELOG.md
```

## Environment variables

See `.env.example` for the full list. Key vars:

| Variable | Purpose | Default |
|---|---|---|
| `POSTGRES_*` | Postgres connection | see `.env.example` |
| `REDIS_URL` | Redis connection | `redis://redis:6379` |
| `KAFKA_BROKERS` | Redpanda bootstrap | `redpanda:9092` |
| `JWT_SECRET` | API auth | **must override in prod** |
| `RIDEX_SEED_PASSWORD` | Password hashed into seed users | `ChangeMe123!` |
| `VITE_MAP_PROVIDER` | Web map provider: `auto`, `yandex`, or fallback tiles | `auto` |
| `VITE_YANDEX_MAPS_API_KEY` | Browser key for Yandex Maps JS API 3.0 | empty |
| `VITE_YANDEX_MAPS_LANG` | Yandex Maps locale | `en_US` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector URL | `http://otel-collector:4318` |
| `MATCHER_REPLICA_IDS` | comma-separated stable matcher IDs for the ring | `matcher-0,matcher-1` |
| `MATCHER_RING_VNODES` | virtual nodes per replica on the ring | `128` |

## Contributing

Branch off `main`, open a PR, request review from one teammate. CI runs lint + tests on PR. Squash
on merge. Each team member commits from **their own GitHub account** — the spec grades commit
history and may zero contributors with no meaningful commits.

## Changelog

See `CHANGELOG.md`.

## Team

See `LINKS.txt`. This file is filled in by the team leader before submission.
