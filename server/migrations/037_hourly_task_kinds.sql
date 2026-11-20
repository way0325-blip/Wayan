ALTER TABLE hourly_task_snapshots ADD COLUMN task_kind TEXT NOT NULL DEFAULT '一般' CHECK(task_kind IN ('一般','WHNDD'));
ALTER TABLE hourly_task_snapshots DROP CONSTRAINT hourly_task_snapshots_cycle_start_fleet_name_key;
ALTER TABLE hourly_task_snapshots ADD CONSTRAINT hourly_task_snapshots_cycle_fleet_kind_key UNIQUE(cycle_start,fleet_name,task_kind);
