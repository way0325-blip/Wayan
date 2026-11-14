CREATE TABLE roster_sheet_requests (
 id UUID PRIMARY KEY,
 request_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('drivers','vehicles')),
 record_uid TEXT,
 submission BIGINT NOT NULL,
 sheet_row INTEGER NOT NULL,
 input_hash TEXT NOT NULL,
 base_version TEXT NOT NULL DEFAULT '',
 raw_input JSONB NOT NULL,
 patch JSONB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('applied','conflict','rejected')),
 message TEXT NOT NULL DEFAULT '',
 result_batch_id BIGINT REFERENCES source_catalog_batches(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 processed_at TIMESTAMPTZ NOT NULL,
 resolved_by TEXT
);
CREATE INDEX roster_sheet_request_status ON roster_sheet_requests(kind,status,created_at DESC);
CREATE INDEX roster_sheet_record_requests ON roster_sheet_requests(kind,record_uid,processed_at DESC);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON roster_sheet_requests FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
