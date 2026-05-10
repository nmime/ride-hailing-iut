-- Transactional outbox metadata for reliable trip-event publishing.
ALTER TABLE trip_events
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_publish_error TEXT;

UPDATE trip_events
   SET published_at = created_at
 WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS trip_events_pending_idx
    ON trip_events (id)
 WHERE published_at IS NULL;
