-- 0004_trip_ratings.sql
-- Riders rate the driver after a completed trip. Maintained as a
-- one-to-one row per trip (`UNIQUE`) so a rider cannot rate the same
-- trip twice. Driver `rating_avg` / `rating_count` are kept consistent
-- by a trigger on insert.

CREATE TABLE trip_ratings (
    trip_id     UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
    rider_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id   UUID NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trip_ratings_driver_idx ON trip_ratings(driver_id, created_at DESC);

-- Maintain drivers.rating_avg / rating_count incrementally.
CREATE OR REPLACE FUNCTION trip_ratings_apply() RETURNS TRIGGER AS $$
DECLARE
    new_count INT;
    new_avg   NUMERIC(3,2);
BEGIN
    SELECT rating_count + 1,
           ROUND(((rating_avg * rating_count) + NEW.rating) / (rating_count + 1), 2)
      INTO new_count, new_avg
      FROM drivers
     WHERE user_id = NEW.driver_id
     FOR UPDATE;

    UPDATE drivers
       SET rating_count = new_count,
           rating_avg   = new_avg
     WHERE user_id = NEW.driver_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trip_ratings_apply_on_insert
AFTER INSERT ON trip_ratings
FOR EACH ROW EXECUTE FUNCTION trip_ratings_apply();
