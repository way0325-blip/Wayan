ALTER TABLE shopee_routes ADD COLUMN IF NOT EXISTS demand_category TEXT NOT NULL DEFAULT '' CHECK (demand_category IN ('', '上收', '上收（周六）', '上收（周日）'));
