# Changelog

All notable changes to RideX are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Scaffold of monorepo: `apps/api` (NestJS+Fastify), `apps/web` (React+Vite), `services/matcher`, `services/ws-gateway`, `services/ingestor`, `libs/consistent-hash`.
- Initial Postgres + PostGIS migration with `users`, `drivers`, `vehicles`, `trips`, `trip_events`, `surge_zones`, `fare_records`.
- Redpanda topics: `driver.location.v1`, `trip.events.v1`.
- Nginx gateway with two `api` replicas behind a single `:80` port.
- OpenTelemetry collector wired to Tempo / Loki / Prometheus / Grafana.
- **`libs/ratelimiter`** — second from-scratch component (R11): token-bucket
  rate limiter with in-memory and Redis (Lua-atomic) backends, 7 property
  tests, integrated as a global Nest guard.
- **`/metrics`** Prometheus exposition (R12): in-process registry,
  `http_server_request_duration_seconds` histogram via interceptor,
  `ridex_trip_events_total`, `ridex_drivers_online`,
  `ridex_ratelimit_decisions_total`.
- **`/me`** endpoint joining `users` × `drivers` for full self-profile.
- **`/vehicles`** CRUD for drivers with class-validator DTOs and
  partial-unique active-vehicle handling.
- **`POST /trips/:id/rating`** with new `trip_ratings` table and a trigger
  that maintains `drivers.rating_avg` / `rating_count`
  (migration `0004_trip_ratings.sql`).
- **Deep `/readyz`** that pings Postgres and Redis (returns 503 when
  either is down).
- **Single error envelope** `{statusCode, code, message, trace_id, details?}`
  via a global `ErrorFilter` reading the active OpenTelemetry span.
- **Redis surge cache fast-path** in `TripsService.complete()` — reads
  `surge:zone:<id>` populated by `services/surge-worker` and falls back
  to PostGIS when the cache is cold.
- **`db/seed/seed-loadtest.sql`** — generates 1 000 drivers + 100 000
  trips for R6 EXPLAIN ANALYZE / k6 measurements.
- `postgres-exporter` service in `docker-compose.yml` for DB metrics.
- `RATELIMIT_*` env vars documented in `.env.example`.

## [0.1.0] — TBD

First end-to-end demo with a rider requesting a trip and a driver completing it.

## [1.0.0] — TBD

Final submission tag (per spec).
