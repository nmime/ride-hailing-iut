-- 0001_extensions.sql
-- Required extensions. PostGIS is the spatial polyglot store (R5).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;           -- fuzzy address search
