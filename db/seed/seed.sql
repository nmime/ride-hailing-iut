-- seed.sql
-- Demo data so the stack is interactive on first boot.
-- Coordinates are around Tashkent (41.31, 69.27) for visual demo on the map.
-- __RIDEX_DEV_PASSWORD_HASH__ is replaced by apps/api/src/scripts/seed.ts
-- with a real argon2id hash of RIDEX_SEED_PASSWORD.

BEGIN;

-- Admin
INSERT INTO users (id, role, full_name, email, phone, password_hash) VALUES
    ('00000000-0000-0000-0000-00000000a000', 'admin',  'Demo Admin',
     'admin@ridex.test', '+998900000000', '__RIDEX_DEV_PASSWORD_HASH__');

-- Riders
INSERT INTO users (id, role, full_name, email, phone, password_hash) VALUES
    ('00000000-0000-0000-0000-00000000c001', 'rider',  'Aziza Rider',
     'aziza@ridex.test',  '+998901111111', '__RIDEX_DEV_PASSWORD_HASH__'),
    ('00000000-0000-0000-0000-00000000c002', 'rider',  'Bekzod Rider',
     'bekzod@ridex.test', '+998902222222', '__RIDEX_DEV_PASSWORD_HASH__');

-- Drivers (need a row in users first)
INSERT INTO users (id, role, full_name, email, phone, password_hash) VALUES
    ('00000000-0000-0000-0000-00000000e001', 'driver', 'Davron Driver',
     'davron@ridex.test', '+998903333333', '__RIDEX_DEV_PASSWORD_HASH__'),
    ('00000000-0000-0000-0000-00000000e002', 'driver', 'Eldor Driver',
     'eldor@ridex.test',  '+998904444444', '__RIDEX_DEV_PASSWORD_HASH__'),
    ('00000000-0000-0000-0000-00000000e003', 'driver', 'Farhod Driver',
     'farhod@ridex.test', '+998905555555', '__RIDEX_DEV_PASSWORD_HASH__');

INSERT INTO drivers (user_id, license_number, license_expires_on, status) VALUES
    ('00000000-0000-0000-0000-00000000e001', 'TX-1001', '2030-01-01', 'online'),
    ('00000000-0000-0000-0000-00000000e002', 'TX-1002', '2030-01-01', 'online'),
    ('00000000-0000-0000-0000-00000000e003', 'TX-1003', '2030-01-01', 'offline');

INSERT INTO vehicles (driver_id, plate, make, model, year, color, capacity, is_active) VALUES
    ('00000000-0000-0000-0000-00000000e001', '01A001AA', 'Chevrolet', 'Cobalt',  2022, 'White', 4, TRUE),
    ('00000000-0000-0000-0000-00000000e002', '01A002AA', 'Chevrolet', 'Lacetti', 2021, 'Silver',4, TRUE),
    ('00000000-0000-0000-0000-00000000e003', '01A003AA', 'Chevrolet', 'Spark',   2020, 'Red',   4, TRUE);

INSERT INTO driver_locations (driver_id, location, heading_deg, speed_mps) VALUES
    ('00000000-0000-0000-0000-00000000e001',
     ST_SetSRID(ST_MakePoint(69.279, 41.311), 4326)::geography,  90, 5),
    ('00000000-0000-0000-0000-00000000e002',
     ST_SetSRID(ST_MakePoint(69.260, 41.320), 4326)::geography, 180, 0),
    ('00000000-0000-0000-0000-00000000e003',
     ST_SetSRID(ST_MakePoint(69.290, 41.295), 4326)::geography,   0, 0);

-- One demo surge zone covering the city centre
INSERT INTO surge_zones (name, polygon, base_multiplier) VALUES
    ('CityCentre',
     ST_SetSRID(ST_GeomFromText(
       'POLYGON((69.24 41.29, 69.30 41.29, 69.30 41.34, 69.24 41.34, 69.24 41.29))'
     ),4326)::geography,
     1.20);

-- One historic completed trip so reports are not empty
INSERT INTO trips (id, rider_id, driver_id, vehicle_id, status, pickup, dropoff,
                   pickup_address, dropoff_address,
                   requested_at, matched_at, started_at, completed_at,
                   fare_total, currency)
SELECT
    '00000000-0000-0000-0000-00000000f001',
    '00000000-0000-0000-0000-00000000c001',
    '00000000-0000-0000-0000-00000000e001',
    v.id,
    'completed',
    ST_SetSRID(ST_MakePoint(69.279, 41.311),4326)::geography,
    ST_SetSRID(ST_MakePoint(69.250, 41.330),4326)::geography,
    'Amir Temur Square', 'Inha University in Tashkent',
    now() - interval '2 hours',
    now() - interval '2 hours' + interval '1 minute',
    now() - interval '2 hours' + interval '5 minutes',
    now() - interval '2 hours' + interval '20 minutes',
    18.50, 'USD'
FROM vehicles v
WHERE v.driver_id = '00000000-0000-0000-0000-00000000e001' AND v.is_active
LIMIT 1;

INSERT INTO fare_records (trip_id, base_fare, distance_km, duration_min, surge_multiplier, total) VALUES
    ('00000000-0000-0000-0000-00000000f001', 5.00, 4.300, 15.00, 1.20, 18.50);

INSERT INTO trip_events (trip_id, event_type, payload) VALUES
    ('00000000-0000-0000-0000-00000000f001', 'requested',  '{"by":"rider"}'),
    ('00000000-0000-0000-0000-00000000f001', 'matched',    '{"driver_id":"00000000-0000-0000-0000-00000000e001"}'),
    ('00000000-0000-0000-0000-00000000f001', 'started',    '{}'),
    ('00000000-0000-0000-0000-00000000f001', 'completed',  '{"fare":18.50}');

COMMIT;

REFRESH MATERIALIZED VIEW mv_driver_daily;
REFRESH MATERIALIZED VIEW mv_hourly_demand;
