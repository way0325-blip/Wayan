CREATE TABLE delivery_checkin_aliases (
 trip_id BIGINT PRIMARY KEY REFERENCES delivery_trips(id),
 service_date TEXT NOT NULL,
 alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 40),
 batch_key UUID NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT delivery_alias_day_unique UNIQUE(service_date,alias) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX delivery_alias_batch ON delivery_checkin_aliases(batch_key);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON delivery_checkin_aliases FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
