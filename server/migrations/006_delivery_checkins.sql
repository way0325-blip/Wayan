ALTER TABLE delivery_trips ADD COLUMN task_code TEXT;
ALTER TABLE delivery_trips ADD COLUMN task_name TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_trips ADD COLUMN required_checkins INTEGER NOT NULL DEFAULT 1 CHECK(required_checkins BETWEEN 1 AND 10000);
UPDATE delivery_trips SET task_code='D'||lpad(id::text,GREATEST(6,length(id::text)),'0');
ALTER TABLE delivery_trips ALTER COLUMN task_code SET NOT NULL;
CREATE UNIQUE INDEX delivery_task_code_unique ON delivery_trips(upper(task_code));
CREATE TABLE delivery_checkins (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
 reporter_hash TEXT NOT NULL,
 event_id TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(trip_id,reporter_hash)
);
CREATE TRIGGER wayan_change AFTER INSERT ON delivery_checkins FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();

ALTER TABLE fleet_incidents ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE fleet_incidents ADD COLUMN delivery_trip_id BIGINT REFERENCES delivery_trips(id);
ALTER TABLE fleet_incidents ADD CONSTRAINT incident_one_task CHECK ((task_id IS NULL) <> (delivery_trip_id IS NULL));
ALTER TABLE penalty_cases ADD COLUMN incident_id BIGINT REFERENCES fleet_incidents(id);
CREATE UNIQUE INDEX penalty_incident_rule ON penalty_cases(incident_id,rule_id) WHERE incident_id IS NOT NULL;
