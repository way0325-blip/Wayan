-- Retain referenced rows and historical names; retire only future selections.
ALTER TABLE delivery_warehouses ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE,
 ADD COLUMN selection_label TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_pickup_points ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE delivery_pickup_points SET active=FALSE WHERE name IN ('大園倉','觀音倉');
UPDATE delivery_warehouses SET active=FALSE,updated_at=NOW() WHERE id='GUANYIN';
-- DAYUAN remains the parent region for the approved Changrong/Shuiyuan sites.
UPDATE delivery_warehouses SET selection_label='大園區（長榮／水源）',updated_at=NOW() WHERE id='DAYUAN';
