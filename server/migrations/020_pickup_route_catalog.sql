CREATE TABLE pickup_route_batches (
 id BIGSERIAL PRIMARY KEY,
 category TEXT NOT NULL CHECK(category IN ('上收','上收（周六）','上收（周日）')),
 source_name TEXT NOT NULL,
 digest TEXT NOT NULL,
 records JSONB NOT NULL,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(category,digest)
);
CREATE TRIGGER pickup_route_notify AFTER INSERT ON pickup_route_batches FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
