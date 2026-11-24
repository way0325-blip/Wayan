ALTER TABLE delivery_checkins ADD COLUMN voided_at TIMESTAMPTZ;
ALTER TABLE delivery_checkins ADD COLUMN voided_by TEXT;
ALTER TABLE delivery_checkins ADD COLUMN void_reason TEXT;
ALTER TABLE delivery_checkins DROP CONSTRAINT delivery_checkins_trip_id_reporter_hash_key;
CREATE UNIQUE INDEX delivery_active_reporter_unique ON delivery_checkins(trip_id,reporter_hash) WHERE voided_at IS NULL;
DROP INDEX delivery_checkin_claim_unique;
CREATE UNIQUE INDEX delivery_checkin_claim_unique ON delivery_checkins(claim_id) WHERE claim_id IS NOT NULL AND voided_at IS NULL;
CREATE VIEW delivery_active_checkins AS SELECT * FROM delivery_checkins WHERE voided_at IS NULL;
CREATE TABLE delivery_trip_returns (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
 claim_id BIGINT REFERENCES delivery_route_claims(id),
 checkin_id BIGINT REFERENCES delivery_checkins(id),
 target_trip_id BIGINT REFERENCES delivery_trips(id),
 reporter_hash TEXT,
 driver_id TEXT REFERENCES drivers(id),
 driver_code TEXT NOT NULL DEFAULT '',
 route_code TEXT NOT NULL,
 fleet_id TEXT REFERENCES partner_fleets(id),
 kind TEXT NOT NULL CHECK(kind IN ('退趟','改報')),
 status TEXT NOT NULL CHECK(status IN ('待覆核','已處理','已拒絕')),
 reason TEXT NOT NULL,
 actor TEXT NOT NULL,
 event_id TEXT NOT NULL UNIQUE,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 processed_at TIMESTAMPTZ,
 reviewed_by TEXT,
 review_note TEXT
);
CREATE INDEX delivery_returns_trip_history ON delivery_trip_returns(trip_id,id DESC);
ALTER TABLE fleet_sheet_rows DROP CONSTRAINT fleet_sheet_rows_sheet_key_check;
ALTER TABLE fleet_sheet_rows ADD CONSTRAINT fleet_sheet_rows_sheet_key_check CHECK(sheet_key IN ('fleets','tasks','incidents','history','rules','penalties','penaltyHistory','routeCheckins','tripReturns'));
ALTER TABLE delivery_route_claims ALTER COLUMN fleet_id DROP NOT NULL;
CREATE UNIQUE INDEX delivery_pending_return_unique ON delivery_trip_returns(trip_id,reporter_hash) WHERE status='待覆核';
DROP TRIGGER wayan_change ON delivery_checkins;
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON delivery_checkins FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON delivery_route_claims FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON delivery_trip_returns FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON source_catalog_batches FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
