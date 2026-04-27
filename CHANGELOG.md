# Changelog

All notable changes to RideX are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Scaffold of monorepo: `apps/api` (NestJS+Fastify), `apps/web` (React+Vite), `services/matcher`, `services/ws-gateway`, `services/ingestor`, `libs/consistent-hash`.
- Initial Postgres + PostGIS migration with `users`, `drivers`, `vehicles`, `trips`, `trip_events`, `surge_zones`, `fare_records`.
- Redpanda topics: `driver.location.v1`, `trip.events.v1`.
- Nginx gateway with two `api` replicas behind a single `:80` port.
- OpenTelemetry collector wired to Tempo / Loki / Prometheus / Grafana.

## [0.1.0] — TBD

First end-to-end demo with a rider requesting a trip and a driver completing it.

## [1.0.0] — TBD

Final submission tag (per spec).
