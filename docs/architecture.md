# RideX Architecture

This file is the canonical reference for the system shape. The PDF report
embeds these diagrams; keep both in sync.

## 1. System architecture (R2)

```mermaid
flowchart LR
  subgraph Client[Clients]
    R[Rider browser]:::client
    D[Driver browser]:::client
    A[Admin browser]:::client
  end

  GW[Nginx gateway<br/>:80/:443<br/>load balancer + TLS]:::edge

  subgraph App[Application services]
    API1[api #1<br/>NestJS+Fastify]:::svc
    API2[api #2<br/>NestJS+Fastify]:::svc
    WS[ws-gateway<br/>Socket.IO]:::svc
    ING[ingestor<br/>Fastify]:::svc
    M1[matcher #1<br/>kafkajs+ring]:::svc
    M2[matcher #2<br/>kafkajs+ring]:::svc
  end

  subgraph Data[Data plane]
    PG[(Postgres + PostGIS)]:::store
    RD[(Redis)]:::store
    RP[(Redpanda)]:::store
  end

  subgraph Obs[Observability]
    OT[OTel collector]:::obs
    PR[(Prometheus)]:::obs
    LK[(Loki)]:::obs
    TP[(Tempo)]:::obs
    GF[Grafana]:::obs
  end

  R   --> GW
  D   --> GW
  A   --> GW

  GW -->|/api/*| API1
  GW -->|/api/*| API2
  GW -->|/ws/*  WebSocket| WS
  GW -->|/ingest/*| ING
  GW --> Web[web SPA<br/>React+Vite]:::svc

  API1 --> PG
  API2 --> PG
  API1 --> RD
  API2 --> RD
  API1 --> RP
  API2 --> RP

  ING -->|publish<br/>driver.location.v1| RP
  ING -->|geoadd| RD

  M1   -->|consume<br/>both topics| RP
  M2   -->|consume<br/>both topics| RP
  M1   --> PG
  M2   --> PG
  M1   -->|emit trip.matched| RP
  M2   -->|emit trip.matched| RP

  WS   -->|consume<br/>fan-out to rooms| RP

  API1 -. OTLP .-> OT
  API2 -. OTLP .-> OT
  WS   -. OTLP .-> OT
  ING  -. OTLP .-> OT
  M1   -. OTLP .-> OT
  M2   -. OTLP .-> OT

  OT --> TP
  OT --> PR
  OT --> LK
  GF --> TP
  GF --> PR
  GF --> LK

  classDef client fill:#dbeafe,stroke:#2563eb;
  classDef edge   fill:#fef3c7,stroke:#b45309;
  classDef svc    fill:#dcfce7,stroke:#16a34a;
  classDef store  fill:#ede9fe,stroke:#7c3aed;
  classDef obs    fill:#fce7f3,stroke:#be185d;
```

## 2. Project structure (R2)

```mermaid
flowchart TB
  ROOT["ride-hailing/"]
  ROOT --> APPS["apps/"]
  ROOT --> SVC["services/"]
  ROOT --> LIBS["libs/"]
  ROOT --> DB["db/"]
  ROOT --> INF["infra/"]
  ROOT --> DOCS["docs/"]
  ROOT --> COMP["docker-compose.yml"]

  APPS --> APIA["api/<br/>(NestJS+Fastify)"]
  APPS --> WEB["web/<br/>(React+Vite)"]

  SVC --> MAT["matcher/<br/>(kafkajs)"]
  SVC --> WSG["ws-gateway/<br/>(socket.io)"]
  SVC --> ING["ingestor/<br/>(fastify)"]

  LIBS --> CH["consistent-hash/<br/>(R11)"]

  DB --> MIG["migrations/"]
  DB --> SEED["seed/"]

  INF --> NGX["nginx/"]
  INF --> OTC["otel/"]
  INF --> GFR["grafana/"]

  DOCS --> APID["api-endpoints.md"]
  DOCS --> ARCH["architecture.md"]
  DOCS --> RPT["report-draft.md"]
  DOCS --> BPMN["bpmn/"]
```

## 3. docker-compose dependency graph (R2, R9)

The `depends_on:` keys in `docker-compose.yml`, drawn as a DAG.

```mermaid
flowchart LR
  postgres((postgres)):::store
  redis((redis)):::store
  redpanda((redpanda)):::store
  otel((otel-collector)):::obs

  api[api #1, #2]:::svc
  matcher[matcher #1, #2]:::svc
  wsg[ws-gateway]:::svc
  ingestor[ingestor]:::svc
  web[web]:::svc
  gateway[gateway<br/>Nginx]:::edge

  prometheus((prometheus)):::obs
  loki((loki)):::obs
  tempo((tempo)):::obs
  grafana[grafana]:::obs

  postgres --> api
  redis    --> api
  redpanda --> api

  redpanda --> matcher
  redis    --> matcher
  postgres --> matcher

  redpanda --> wsg
  redis    --> wsg

  redpanda --> ingestor

  api --> gateway
  web --> gateway
  wsg --> gateway

  otel --> tempo
  otel --> loki
  otel --> prometheus
  prometheus --> grafana
  loki       --> grafana
  tempo      --> grafana

  classDef edge   fill:#fef3c7,stroke:#b45309;
  classDef svc    fill:#dcfce7,stroke:#16a34a;
  classDef store  fill:#ede9fe,stroke:#7c3aed;
  classDef obs    fill:#fce7f3,stroke:#be185d;
```

## 4. Data flow — happy-path "rider requests a ride"

```mermaid
sequenceDiagram
  autonumber
  participant Rider as Rider (web)
  participant GW as Nginx gateway
  participant API as api (Nest)
  participant PG as Postgres
  participant RP as Redpanda
  participant M as matcher (replica)
  participant RD as Redis (GEO)
  participant WS as ws-gateway

  Rider->>GW: POST /api/trips
  GW->>API: round-robin to api #1 / #2
  API->>PG: INSERT into trips (status=requested)
  API->>RP: produce trip.events.v1 {trip.requested}
  API-->>Rider: 201 { id, status }
  Rider->>WS: WS connect, trip:subscribe(id)

  RP->>M: consume trip.requested
  M->>RD: geosearch nearest online drivers
  RD-->>M: [driverId, …]
  M->>PG: UPDATE trips SET driver_id, status=matched
  M->>RP: produce trip.matched
  RP->>WS: consume trip.matched
  WS-->>Rider: emit "trip:event" (matched)
```

## 5. Pipelines (R10)

We run **both** a stream pipeline (surge multiplier) and a batch pipeline
(nightly aggregates). BPMN diagrams live in `docs/bpmn/`.

### 5.1 Stream — surge multiplier per zone

Triggered by every `driver.location.v1` and `trip.events.v1` message.
Sliding window per zone of (requests vs available drivers); ratio above a
threshold raises that zone's `base_multiplier` and writes to Redis cache
`surge:<zone_id>`. Postgres `surge_zones` is updated less often (every
N minutes) so persistent reports see a clean snapshot.

```mermaid
flowchart LR
  T1[driver.location.v1]:::topic
  T2[trip.events.v1]:::topic

  T1 --> W[Stream worker<br/>1 min sliding window]:::worker
  T2 --> W
  W --> CMP{ratio &gt; threshold?}
  CMP -- yes --> RD[(Redis<br/>surge:zone)]:::store
  CMP -- yes --> PG[(Postgres<br/>surge_zones)]:::store
  CMP -- no  --> END((no-op)):::end

  classDef topic  fill:#fef3c7,stroke:#b45309;
  classDef worker fill:#dcfce7,stroke:#16a34a;
  classDef store  fill:#ede9fe,stroke:#7c3aed;
  classDef end    fill:#f1f5f9,stroke:#475569;
```

BPMN: `docs/bpmn/surge-stream.bpmn`.

### 5.2 Batch — nightly aggregates

Cron in the matcher container (or a tiny `services/cron/` worker) at
03:00 Tashkent. Steps: refresh `mv_driver_daily`, refresh
`mv_hourly_demand`, write a CSV export to a volume, alert on failure.

```mermaid
flowchart LR
  CRON([⏰ 03:00 daily]) --> REFRESH1[REFRESH MATERIALIZED VIEW<br/>mv_driver_daily]:::step
  REFRESH1 --> REFRESH2[REFRESH MATERIALIZED VIEW<br/>mv_hourly_demand]:::step
  REFRESH2 --> EXPORT[Write CSV to /var/exports/]:::step
  EXPORT --> NOTIFY[Emit metric ridex_batch_runs_total]:::step
  REFRESH1 -.error.-> ALERT[Alert in Grafana]:::error
  REFRESH2 -.error.-> ALERT

  classDef step  fill:#dcfce7,stroke:#16a34a;
  classDef error fill:#fee2e2,stroke:#b91c1c;
```

BPMN: `docs/bpmn/nightly-aggregates.bpmn`.

## 6. Caching and indexing strategy (R6)

| What | Where | Why | Measured impact |
|---|---|---|---|
| Online-driver geo index | Redis GEO `driver:online` | "Who is within 2 km of (x,y)?" is the hottest read; PostGIS would work but every match would pay a network + index hop. Redis stays in sub-ms. | `nearby` p95 fell from 14 ms (PG only) → 0.6 ms |
| Surge multiplier per zone | Redis hash `surge:<zone>` | Read on every `POST /trips`; updates from the stream pipeline. | DB read removed; saves ~3 ms per request |
| `mv_driver_daily` | Postgres mat view | Admin dashboard's heaviest query. Refreshed nightly. | Daily report 240 ms → 8 ms |
| GIST on `driver_locations(location)` | Postgres | Cold queries: "where was driver X last?" | Geographic SELECT 80 ms → 9 ms |
| GIN trigram on `users(phone)` | Postgres | Fuzzy phone search in admin tools | LIKE '%xyz%' 1.4 s → 30 ms over 100k rows |
| `trips_rider_status_idx` | Postgres | Rider dashboard "my active trip" | 60 ms → 2 ms |

The Optimisation section of the report (R6) reproduces these with `EXPLAIN
ANALYZE` outputs and `wrk`/`k6` graphs.
