CREATE TABLE route_overrides (
 uid TEXT PRIMARY KEY CHECK(uid ~ '^[a-f0-9]{64}$'), category TEXT NOT NULL, route_code TEXT NOT NULL, source_row INTEGER NOT NULL,
 patch JSONB NOT NULL DEFAULT '{}', revision BIGINT NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE route_sheet_requests (
 request_key TEXT PRIMARY KEY, uid TEXT NOT NULL, submission BIGINT NOT NULL CHECK(submission>0), input_hash TEXT NOT NULL,
 base_version TEXT NOT NULL, patch JSONB NOT NULL, raw_input JSONB NOT NULL, status TEXT NOT NULL CHECK(status IN ('applied','conflict','rejected')),
 message TEXT NOT NULL, resolved_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(uid,submission)
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON route_overrides FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
