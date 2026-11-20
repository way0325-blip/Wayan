ALTER TABLE drivers ADD COLUMN roster_source_id TEXT;
ALTER TABLE drivers ADD COLUMN roster_source_row INTEGER;
ALTER TABLE drivers ADD COLUMN roster_driver_id TEXT;
CREATE UNIQUE INDEX drivers_roster_identity ON drivers(roster_source_id,roster_driver_id) WHERE roster_source_id IS NOT NULL;
ALTER TABLE delivery_trips ADD COLUMN driver_claim_required BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE delivery_trips SET driver_claim_required=FALSE WHERE is_simulated=TRUE OR required_checkins<>1 OR (SELECT count(DISTINCT NULLIF(s.route_code,'')) FROM delivery_trip_stops s WHERE s.trip_id=delivery_trips.id)<>1 OR status IN ('已完成','已取消') OR EXISTS(SELECT 1 FROM delivery_checkins c WHERE c.trip_id=delivery_trips.id);
CREATE TABLE delivery_route_claims (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
 driver_id TEXT NOT NULL REFERENCES drivers(id),
 driver_code TEXT NOT NULL,
 driver_name TEXT NOT NULL,
 reporter_hash TEXT NOT NULL,
 route_code TEXT NOT NULL,
 service_date TEXT NOT NULL,
 fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
 fleet_name TEXT NOT NULL,
 departure_time TEXT NOT NULL,
 stop_count INTEGER NOT NULL CHECK(stop_count BETWEEN 1 AND 200),
 event_id TEXT NOT NULL UNIQUE,
 accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 checked_in_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 revoked_by TEXT,
 revoke_reason TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX delivery_route_active_claim ON delivery_route_claims(trip_id) WHERE revoked_at IS NULL;
CREATE INDEX delivery_route_driver_claims ON delivery_route_claims(driver_id,service_date);
ALTER TABLE delivery_checkins ADD COLUMN driver_id TEXT REFERENCES drivers(id);
ALTER TABLE delivery_checkins ADD COLUMN claim_id BIGINT REFERENCES delivery_route_claims(id);
CREATE UNIQUE INDEX delivery_checkin_claim_unique ON delivery_checkins(claim_id) WHERE claim_id IS NOT NULL;
ALTER TABLE fleet_sheet_rows DROP CONSTRAINT fleet_sheet_rows_sheet_key_check;
ALTER TABLE fleet_sheet_rows ADD CONSTRAINT fleet_sheet_rows_sheet_key_check CHECK(sheet_key IN ('fleets','tasks','incidents','history','rules','penalties','penaltyHistory','routeCheckins'));
