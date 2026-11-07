-- Source snapshots are separate from dispatchable resources. No existing rows are replaced.
CREATE TABLE source_catalog_batches (
 id BIGSERIAL PRIMARY KEY,
 source_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 sheet_id INTEGER NOT NULL,
 sheet_name TEXT NOT NULL,
 digest TEXT NOT NULL,
 records JSONB NOT NULL,
 issues JSONB NOT NULL,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(source_id,kind,digest)
);
CREATE INDEX source_catalog_latest ON source_catalog_batches(source_id,kind,id DESC);
CREATE TABLE source_catalog_trip_links (
 source_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 route_code TEXT NOT NULL,
 service_date TEXT NOT NULL,
 batch_id BIGINT NOT NULL REFERENCES source_catalog_batches(id),
 trip_id BIGINT NOT NULL UNIQUE REFERENCES delivery_trips(id),
 PRIMARY KEY(source_id,kind,route_code,service_date)
);
