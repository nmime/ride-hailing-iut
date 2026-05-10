-- seed-loadtest.sql
-- Generates ~1 000 synthetic drivers and ~100 000 historical trips so the
-- R6 EXPLAIN ANALYZE / k6 measurements have a realistic dataset to work
-- against. Run AFTER seed.sql.
--
--   docker compose exec -T postgres \
--     psql -U $POSTGRES_USER -d $POSTGRES_DB -f /seed/seed-loadtest.sql
--
-- Argon2id is expensive, so all generated users share a single hash —
-- the same hash that `apps/api/src/scripts/seed.ts` writes for the demo
-- accounts. After the first real `seed.ts` run that hash exists in the
-- database; this script copies it.

BEGIN;

-- 1. Borrow the hash that seed.ts already produced for the demo admin.
--    If seed.sql hasn't run yet we error loudly.
DO $$
DECLARE
    sample_hash TEXT;
BEGIN
    SELECT password_hash INTO sample_hash
      FROM users WHERE phone = '+998900000000' LIMIT 1;
    IF sample_hash IS NULL THEN
        RAISE EXCEPTION 'seed.sql must run before seed-loadtest.sql so the demo admin hash exists';
    END IF;

    -- 2. 1 000 drivers — one user row, one drivers row, one vehicle row each.
    INSERT INTO users (id, role, full_name, email, phone, password_hash)
    SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(1000000 + g)::text, 12, '0'))::uuid,
           'driver',
           'LoadTest Driver ' || g,
           'lt-driver-' || g || '@ridex.test',
           '+99899' || lpad(g::text, 7, '0'),
           sample_hash
      FROM generate_series(1, 1000) AS g
      ON CONFLICT (phone) DO NOTHING;

    INSERT INTO drivers (user_id, license_number, license_expires_on, status)
    SELECT u.id, 'LT-' || lpad(g::text, 6, '0'), '2030-01-01', 'online'
      FROM generate_series(1, 1000) AS g
      JOIN users u ON u.phone = '+99899' || lpad(g::text, 7, '0')
      ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO vehicles (driver_id, plate, make, model, year, color, capacity, is_active)
    SELECT d.user_id,
           'LT' || lpad(g::text, 6, '0'),
           'Chevrolet', 'Cobalt', 2022, 'White', 4, TRUE
      FROM generate_series(1, 1000) AS g
      JOIN users u ON u.phone = '+99899' || lpad(g::text, 7, '0')
      JOIN drivers d ON d.user_id = u.id
      ON CONFLICT (plate) DO NOTHING;

    -- 3. Spread driver_locations around Tashkent (~41.30, 69.27). Random
    --    jitter inside a 0.10 lat × 0.20 lon bbox simulates a realistic
    --    fleet distribution.
    INSERT INTO driver_locations (driver_id, location, heading_deg, speed_mps, updated_at)
    SELECT d.user_id,
           ST_SetSRID(ST_MakePoint(
             69.18 + (random() * 0.20),
             41.28 + (random() * 0.10)
           ), 4326)::geography,
           floor(random() * 360)::real,
           (random() * 12)::real,
           now() - (random() * interval '5 minutes')
      FROM drivers d
      WHERE d.user_id IN (
        SELECT user_id FROM drivers
         WHERE license_number LIKE 'LT-%'
      )
      ON CONFLICT (driver_id) DO UPDATE
         SET location = EXCLUDED.location,
             updated_at = EXCLUDED.updated_at;
END $$;

-- 4. 100 000 historical completed trips, evenly distributed across the
--    last 30 days, to give the admin daily-report query meaningful data.
INSERT INTO trips (id, rider_id, driver_id, status, pickup, dropoff,
                   pickup_address, dropoff_address,
                   requested_at, matched_at, started_at, completed_at,
                   fare_total, currency)
SELECT gen_random_uuid(),
       (SELECT id FROM users WHERE role = 'rider' LIMIT 1),
       (SELECT user_id FROM drivers ORDER BY user_id OFFSET (g % 1000) LIMIT 1),
       'completed',
       ST_SetSRID(ST_MakePoint(69.20 + (random() * 0.18), 41.29 + (random() * 0.08)), 4326)::geography,
       ST_SetSRID(ST_MakePoint(69.20 + (random() * 0.18), 41.29 + (random() * 0.08)), 4326)::geography,
       'load-pickup', 'load-dropoff',
       now() - (random() * interval '30 days') - interval '20 minutes',
       now() - (random() * interval '30 days') - interval '19 minutes',
       now() - (random() * interval '30 days') - interval '18 minutes',
       now() - (random() * interval '30 days'),
       round((5 + random() * 30)::numeric, 2),
       'USD'
  FROM generate_series(1, 100000) AS g;

-- Match fare_records to the trips just inserted so admin reports work.
INSERT INTO fare_records (trip_id, base_fare, distance_km, duration_min, surge_multiplier, total)
SELECT t.id, 2.50,
       round((0.5 + random() * 12)::numeric, 3),
       round((1 + random() * 30)::numeric, 2),
       round((1.00 + random() * 0.80)::numeric, 2),
       t.fare_total
  FROM trips t
  WHERE t.pickup_address = 'load-pickup'
  ON CONFLICT (trip_id) DO NOTHING;

COMMIT;

-- 5. Refresh materialised views so the daily report has data.
REFRESH MATERIALIZED VIEW mv_driver_daily;
REFRESH MATERIALIZED VIEW mv_hourly_demand;

-- 6. Helpful summary so the operator knows it worked.
SELECT
  (SELECT COUNT(*) FROM drivers WHERE license_number LIKE 'LT-%') AS load_drivers,
  (SELECT COUNT(*) FROM trips   WHERE pickup_address = 'load-pickup') AS load_trips,
  (SELECT COUNT(*) FROM mv_driver_daily) AS daily_rows;
