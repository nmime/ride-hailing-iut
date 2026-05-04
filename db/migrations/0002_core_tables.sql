-- 0002_core_tables.sql
-- Core relational schema for RideX. Hand-designed; the ER diagram in
-- docs/report-draft.md is the source of truth for relationships.

CREATE TYPE user_role AS ENUM ('rider', 'driver', 'admin');
CREATE TYPE driver_status AS ENUM ('offline', 'online', 'on_trip', 'suspended');
CREATE TYPE trip_status AS ENUM (
    'requested',     -- rider submitted, no driver yet
    'matched',       -- driver accepted, en route to pickup
    'in_progress',   -- rider on board
    'completed',
    'cancelled_by_rider',
    'cancelled_by_driver',
    'expired'        -- no driver accepted within timeout
);

-- ---------------------------------------------------------------------------
-- users: identity row for everyone (rider, driver, admin). Driver- and
-- rider-specific attributes live in their own tables to keep this thin.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            user_role     NOT NULL,
    full_name       TEXT          NOT NULL,
    email           TEXT          NOT NULL UNIQUE,
    phone           TEXT          NOT NULL UNIQUE,
    password_hash   TEXT          NOT NULL,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX users_phone_trgm_idx ON users USING gin (phone gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- drivers: extends users with driver-specific data. one-to-one with users.
-- ---------------------------------------------------------------------------
CREATE TABLE drivers (
    user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    license_number     TEXT NOT NULL UNIQUE,
    license_expires_on DATE NOT NULL,
    status             driver_status NOT NULL DEFAULT 'offline',
    rating_avg         NUMERIC(3,2) NOT NULL DEFAULT 5.00 CHECK (rating_avg BETWEEN 0 AND 5),
    rating_count       INT  NOT NULL DEFAULT 0,
    onboarded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drivers_status_idx ON drivers(status) WHERE status IN ('online','on_trip');

-- ---------------------------------------------------------------------------
-- vehicles: a driver may register multiple vehicles, one is "active".
-- ---------------------------------------------------------------------------
CREATE TABLE vehicles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id    UUID NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
    plate        TEXT NOT NULL UNIQUE,
    make         TEXT NOT NULL,
    model        TEXT NOT NULL,
    year         INT  NOT NULL CHECK (year BETWEEN 1990 AND 2100),
    color        TEXT NOT NULL,
    capacity     INT  NOT NULL CHECK (capacity BETWEEN 1 AND 8),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_driver_idx ON vehicles(driver_id);
CREATE UNIQUE INDEX one_active_vehicle_per_driver
    ON vehicles(driver_id) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- driver_locations: latest known position per driver. The full ping stream
-- lives in Redpanda (`driver.location.v1`); this table is the materialised
-- *current* state for cold queries (e.g. "where was driver X last seen").
-- ---------------------------------------------------------------------------
CREATE TABLE driver_locations (
    driver_id    UUID PRIMARY KEY REFERENCES drivers(user_id) ON DELETE CASCADE,
    location     geography(POINT, 4326) NOT NULL,
    heading_deg  REAL    CHECK (heading_deg BETWEEN 0 AND 360),
    speed_mps    REAL    CHECK (speed_mps  >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_locations_geo_idx ON driver_locations USING GIST(location);

-- ---------------------------------------------------------------------------
-- surge_zones: admin-defined polygons with a multiplier. A zone's multiplier
-- is also recomputed by the streaming pipeline (R10) and cached in Redis.
-- ---------------------------------------------------------------------------
CREATE TABLE surge_zones (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    polygon      geography(POLYGON, 4326) NOT NULL,
    base_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (base_multiplier >= 1.00),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX surge_zones_geo_idx ON surge_zones USING GIST(polygon);

-- ---------------------------------------------------------------------------
-- trips: the central booking entity.
-- ---------------------------------------------------------------------------
CREATE TABLE trips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id        UUID NOT NULL REFERENCES users(id),
    driver_id       UUID REFERENCES drivers(user_id),
    vehicle_id      UUID REFERENCES vehicles(id),
    status          trip_status NOT NULL DEFAULT 'requested',
    pickup          geography(POINT, 4326) NOT NULL,
    dropoff         geography(POINT, 4326) NOT NULL,
    pickup_address  TEXT,
    dropoff_address TEXT,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched_at      TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancellation_reason TEXT,
    -- materialised fare snapshot for fast "trip history" queries
    -- (full breakdown is in fare_records)
    fare_total      NUMERIC(10,2),
    currency        CHAR(3) NOT NULL DEFAULT 'USD'
);
CREATE INDEX trips_rider_status_idx ON trips(rider_id, status);
CREATE INDEX trips_driver_status_idx ON trips(driver_id, status) WHERE driver_id IS NOT NULL;
CREATE INDEX trips_requested_at_idx ON trips(requested_at DESC);
CREATE INDEX trips_pickup_geo_idx   ON trips USING GIST(pickup);

-- ---------------------------------------------------------------------------
-- trip_events: append-only audit of every state change for a trip.
-- The stream pipeline mirrors these events into Redpanda (`trip.events.v1`).
-- ---------------------------------------------------------------------------
CREATE TABLE trip_events (
    id          BIGSERIAL PRIMARY KEY,
    trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,             -- requested, matched, started, ...
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trip_events_trip_idx ON trip_events(trip_id, created_at);

-- ---------------------------------------------------------------------------
-- fare_records: full fare breakdown. Emitted at trip completion.
-- ---------------------------------------------------------------------------
CREATE TABLE fare_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id           UUID NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
    base_fare         NUMERIC(10,2) NOT NULL,
    distance_km       NUMERIC(7,3)  NOT NULL CHECK (distance_km >= 0),
    duration_min      NUMERIC(7,2)  NOT NULL CHECK (duration_min >= 0),
    surge_multiplier  NUMERIC(3,2)  NOT NULL CHECK (surge_multiplier >= 1.00),
    total             NUMERIC(10,2) NOT NULL,
    currency          CHAR(3)       NOT NULL DEFAULT 'USD',
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- payment_methods: tokenised references for fare settlement. External PSP
-- integration is outside this course project, so no card PAN is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_methods (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('card','wallet','cash')),
    last4        CHAR(4),
    is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_methods_user_idx ON payment_methods(user_id);

-- ---------------------------------------------------------------------------
-- audit_log: who did what, for admin queries.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_actor_idx  ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Helper: bump updated_at on row changes for tables that have it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at         BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER surge_zones_set_updated_at   BEFORE UPDATE ON surge_zones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
