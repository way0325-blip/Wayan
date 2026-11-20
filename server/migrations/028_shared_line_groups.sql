CREATE TABLE IF NOT EXISTS line_shared_group_fleets (
 group_id TEXT NOT NULL REFERENCES line_group_registry(group_id),
 fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(group_id,fleet_id)
);

ALTER TABLE line_shared_group_fleets ADD COLUMN IF NOT EXISTS business_scope TEXT NOT NULL DEFAULT 'all' CHECK(business_scope IN ('all','orange','black'));

CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON line_shared_group_fleets FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
