-- 0003_views_and_aggregates.sql
-- Materialised views for R6 (read-path optimisation). The nightly batch
-- pipeline (R10) refreshes them.

-- Per-driver daily summary (for admin dashboard, P&L)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_driver_daily AS
SELECT
    t.driver_id,
    date_trunc('day', t.completed_at) AS day,
    COUNT(*)                          AS trips,
    COALESCE(SUM(f.distance_km), 0)   AS total_km,
    COALESCE(SUM(f.duration_min), 0)  AS total_minutes,
    COALESCE(SUM(f.total), 0)         AS gross_revenue
FROM trips t
JOIN fare_records f ON f.trip_id = t.id
WHERE t.status = 'completed'
GROUP BY t.driver_id, date_trunc('day', t.completed_at);

CREATE UNIQUE INDEX IF NOT EXISTS mv_driver_daily_pk
    ON mv_driver_daily(driver_id, day);

-- City-wide hourly trip counts (for surge backfill / capacity planning)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_demand AS
SELECT
    date_trunc('hour', requested_at) AS hour,
    ST_SnapToGrid(pickup::geometry, 0.01)::geography AS cell,
    COUNT(*) AS requests
FROM trips
GROUP BY date_trunc('hour', requested_at), ST_SnapToGrid(pickup::geometry, 0.01);

CREATE INDEX IF NOT EXISTS mv_hourly_demand_hour_idx
    ON mv_hourly_demand(hour DESC);
