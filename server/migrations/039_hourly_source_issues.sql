ALTER TABLE hourly_task_snapshots ADD COLUMN issues JSONB NOT NULL DEFAULT '[]';
