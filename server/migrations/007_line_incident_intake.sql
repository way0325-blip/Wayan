ALTER TABLE fleet_incidents ADD COLUMN report_scope TEXT NOT NULL DEFAULT '任務' CHECK(report_scope IN ('任務','車隊'));
ALTER TABLE fleet_incidents DROP CONSTRAINT incident_one_task;
ALTER TABLE fleet_incidents ADD CONSTRAINT incident_one_task CHECK (
 (report_scope='任務' AND num_nonnulls(task_id,delivery_trip_id)=1) OR
 (report_scope='車隊' AND num_nonnulls(task_id,delivery_trip_id)=0)
);
CREATE TABLE line_incident_sessions (
 group_id TEXT NOT NULL REFERENCES line_fleet_groups(group_id) ON DELETE CASCADE,
 reporter_hash TEXT NOT NULL,
 fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
 expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(group_id,reporter_hash)
);
