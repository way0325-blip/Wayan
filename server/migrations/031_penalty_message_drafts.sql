CREATE TABLE penalty_message_drafts (
 id BIGSERIAL PRIMARY KEY,
 source_event_id TEXT NOT NULL UNIQUE REFERENCES line_events(event_id),
 source_group_id TEXT NOT NULL REFERENCES line_group_registry(group_id),
 route_code TEXT NOT NULL,
 driver_code TEXT NOT NULL,
 violation_kind TEXT NOT NULL,
 source_amount NUMERIC(12,2) NOT NULL,
 source_text TEXT NOT NULL,
 case_id BIGINT UNIQUE REFERENCES penalty_cases(id),
 status TEXT NOT NULL DEFAULT '待核對',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON penalty_message_drafts FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
