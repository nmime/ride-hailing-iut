# Changelog

This changelog follows the commit history on `main` for the two-week RideX
development window.

## [2026-05-17]

- `65b6ab7` Marat - `feat(lib): implement token bucket rate limiter backends and tests`
- `10542af` Nikita - `docs(submission): link team profiles and commit timeline`
- `c9ec0e4` Nikita - `refactor(services): split worker entrypoints into modules`
- `152a462` Marat - `chore(format): add workspace lint and prettier pass`
- `2c8654b` Nikita - `refactor(shared): consolidate service runtime helpers`
- `5dd8a4b` Nikita - `docs(submission): add final report pdf`
- `9470087` Nikita - `refactor: standardize vehicle modules and service utilities`
- `8f3dfb8` Nikita - `refactor(web): include vehicle UI test and panel refactors`
- `f745ed4` Nikita - `chore: apply RideX demo auth patch`
- `54f791d` Nikita - `fix(auth): enable secure demo login`
- `7225076` Nikita - `chore: apply RideX hardening patch`
- `79474f5` Nikita - `fix(auth): harden demo login and block grafana`

## [2026-05-16]

- `14d45eb` Nikita - `docs(report): add submission report draft and team ownership table`

## [2026-05-15]

- `ef1f7e0` Nikita - `docs(team): add optimisation notes and contributor summary`

## [2026-05-14]

- `dfbb94a` Marat - `chore(lib): scaffold token bucket rate limiter package`
- `febeea4` Saidamir - `docs(api): add migration scripts and endpoint reference`
- `8104a69` Timur - `test(web): add interaction coverage for auth and trip flows`

## [2026-05-13]

- `7f68deb` Marat - `feat(lib): implement consistent hashing ring and tests`
- `27a8a29` Timur - `feat(realtime): add trip socket hook and ride map`
- `a439c9c` Saidamir - `feat(api): add error filter, telemetry hook, and validation coverage`

## [2026-05-12]

- `30620b8` Marat - `chore(lib): scaffold consistent hashing package`
- `fcd957e` Saidamir - `feat(platform): add rate limiting and HTTP metrics`
- `4cdc1f0` Timur - `feat(trips): add trip history and rating dialog`
- `b5913f9` Nikita - `docs(flow): add BPMN diagrams for trip lifecycle and stream processing`

## [2026-05-11]

- `e773191` Marat - `feat(obs): add ride operations dashboard panels`
- `e6988b2` Timur - `feat(web): add API client and UI utility hooks`
- `3ca2a2c` Saidamir - `feat(trips): implement trip controller and service flows`
- `3110f25` Nikita - `test(smoke): add end-to-end smoke script and workspace lockfile`

## [2026-05-10]

- `ecf603a` Marat - `feat(obs): provision Grafana datasources and dashboard loader`
- `331631b` Saidamir - `feat(trips): add trip DTOs and module registration`
- `c2b7075` Timur - `feat(admin): add admin dashboard shell and vehicle panel`
- `f7d7c31` Nikita - `test(load): add k6 scenarios for driver pings and trip creation`

## [2026-05-09]

- `2f17a25` Marat - `feat(obs): add Loki and Tempo pipeline configuration`
- `8e24272` Saidamir - `feat(fleet): add driver and vehicle modules`
- `d1a0b31` Timur - `feat(driver): add driver workspace and active trip card`
- `e339ffa` Nikita - `feat(cron): add nightly aggregate refresh worker`

## [2026-05-08]

- `a51ba59` Marat - `feat(obs): add OpenTelemetry collector and Prometheus scrape config`
- `e825611` Saidamir - `feat(api): wire database, redis, and kafka providers`
- `50b05ad` Timur - `feat(rider): add landing and rider booking flows`
- `4a9a730` Nikita - `feat(surge): add stream worker for surge calculations`

## [2026-05-07]

- `bb1c7b8` Marat - `feat(proxy): add nginx gateway and service routing`
- `ab587d7` Saidamir - `feat(auth): add auth module, DTOs, and JWT guard`
- `ed23926` Timur - `feat(auth-ui): add auth gate and user menu controls`
- `6cfbbe9` Nikita - `feat(ws): add websocket gateway for trip events`

## [2026-05-06]

- `bf00f3a` Marat - `chore(infra): add local compose stack for core services`
- `0050871` Saidamir - `chore(api): scaffold NestJS API service`
- `ba73c73` Timur - `style(web): add base styles and auth polish`
- `ef0bfcc` Nikita - `feat(ingestor): add driver location ingestion service`

## [2026-05-05]

- `6a847fa` Marat - `chore(ci): add environment template and bootstrap workflow`
- `aa87f43` Saidamir - `feat(db): add aggregates, ratings, and outbox migrations`
- `a909262` Timur - `feat(web): add application shell and entrypoint`
- `d58f634` Nikita - `feat(matcher): add driver matcher worker`

## [2026-05-04]

- `69d7b0a` Marat - `chore(repo): initialize workspace tooling and ignores`
- `d48926b` Saidamir - `feat(db): add Postgres extensions and core ride schema`
- `923ffeb` Timur - `chore(web): scaffold Vite frontend container`
- `4b768ef` Nikita - `docs(arch): add project overview and useful links`
