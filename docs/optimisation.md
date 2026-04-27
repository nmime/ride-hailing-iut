# R6 — Cache, Indexing, and Storage Optimisation

This file collects the *before/after* numbers the rubric requires. Run the
queries below before applying each optimisation, then again after, and
record both. Paste the screenshots / values into §8 of the report.

> **Setup.** Seed 100 000 fake trips and 1 000 fake drivers using
> `db/seed/seed-loadtest.sql` (one-line `INSERT … FROM generate_series`).
> Time each query three times and use the median.

## 1. Online-driver geosearch — Postgres vs Redis GEO

### Before (PostGIS only)

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT user_id
    FROM driver_locations
   WHERE ST_DWithin(location,
                    ST_SetSRID(ST_MakePoint(69.279, 41.311),4326)::geography,
                    2000)
   ORDER BY location <-> ST_SetSRID(ST_MakePoint(69.279, 41.311),4326)::geography
   LIMIT 5;
```

Record the `Execution Time` line.

### After (Redis GEO)

```bash
redis-cli GEOSEARCH driver:online \
  FROMLONLAT 69.279 41.311 \
  BYRADIUS 2000 m COUNT 5 ASC
```

Record the latency reported by `redis-cli --latency` against the same query.

### Expected

| | p50 | p95 |
|---|---|---|
| PostGIS  | __ ms | __ ms |
| Redis GEO | __ ms | __ ms |
| **Speedup** | __× | __× |

Our scaffold expects ~14 ms → ~0.6 ms; reality on your hardware will
differ — that's fine, **just record what you measure.**

## 2. Admin daily report — table scan vs materialised view

### Before

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT t.driver_id, date_trunc('day', t.completed_at) AS day,
         COUNT(*) AS trips, SUM(f.total) AS rev
    FROM trips t JOIN fare_records f ON f.trip_id = t.id
   WHERE t.status = 'completed'
   GROUP BY t.driver_id, date_trunc('day', t.completed_at)
   ORDER BY day DESC LIMIT 200;
```

### After

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM mv_driver_daily ORDER BY day DESC LIMIT 200;
```

## 3. Phone fuzzy lookup — sequential scan vs GIN trigram

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT id FROM users WHERE phone LIKE '%5555%';
```

Run before and after `users_phone_trgm_idx` is created. The trigram index
is in `0002_core_tables.sql` already; to compare without it run
`DROP INDEX users_phone_trgm_idx;` and re-run.

## 4. End-to-end p95 — `POST /trips` with vs without surge cache

Use `k6 run load/k6-trip-create.js` after disabling the Redis cache
(comment out the `redis.hget('surge:zone:...')` line in your fare
quote and fall back to a Postgres SELECT). Re-enable, re-run.

| | p50 | p95 | error rate |
|---|---|---|---|
| Postgres for every quote | __ | __ | __ |
| Redis cache              | __ | __ | __ |

## 5. Ingestor + matcher chain — sustained throughput

`k6 run load/k6-driver-pings.js` with 1000 VUs / 60s.
Capture: ingestor request rate, Redpanda publish rate, matcher consumer lag.

Screenshot the Grafana panel showing all three lines correlated.
