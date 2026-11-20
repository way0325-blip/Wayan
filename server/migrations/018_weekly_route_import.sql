CREATE TABLE dispatch_source_batches (
 id BIGSERIAL PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('mapping','weekly')),
 source_id TEXT NOT NULL,
 sheet_name TEXT NOT NULL,
 period_start TEXT,
 period_end TEXT,
 digest TEXT NOT NULL,
 records JSONB NOT NULL,
 issues JSONB NOT NULL,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(kind,digest)
);
CREATE INDEX dispatch_source_period ON dispatch_source_batches(kind,period_start,period_end,id DESC);
CREATE TABLE dispatch_source_fleet_aliases (
 source_name TEXT PRIMARY KEY,
 fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
 version UUID NOT NULL DEFAULT gen_random_uuid(),
 updated_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE dispatch_source_trip_links (
 service_date TEXT NOT NULL,
 route_code TEXT NOT NULL,
 batch_id BIGINT NOT NULL REFERENCES dispatch_source_batches(id),
 route_hash TEXT NOT NULL,
 trip_id BIGINT NOT NULL UNIQUE REFERENCES delivery_trips(id),
 PRIMARY KEY(service_date,route_code)
);
ALTER TABLE delivery_trips ADD COLUMN dock_code TEXT NOT NULL DEFAULT '', ADD COLUMN source_fleet_name TEXT NOT NULL DEFAULT '', ADD COLUMN source_period_name TEXT NOT NULL DEFAULT '';
INSERT INTO delivery_warehouses(id,name) VALUES('INTERNATIONAL_DOCK','國際倉') ON CONFLICT DO NOTHING;
INSERT INTO delivery_pickup_points(id,warehouse_id,name,box_type) VALUES('GUOJI','INTERNATIONAL_DOCK','國際倉','橘箱') ON CONFLICT DO NOTHING;
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON dispatch_source_batches FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON dispatch_source_fleet_aliases FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
