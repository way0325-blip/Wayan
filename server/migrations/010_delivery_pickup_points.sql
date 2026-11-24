CREATE TABLE delivery_pickup_points (
 id TEXT PRIMARY KEY,
 warehouse_id TEXT NOT NULL REFERENCES delivery_warehouses(id),
 name TEXT NOT NULL UNIQUE,
 box_type TEXT NOT NULL CHECK(box_type IN ('黑箱','橘箱')),
 address TEXT NOT NULL DEFAULT ''
);
INSERT INTO delivery_pickup_points(id,warehouse_id,name,box_type) VALUES
 ('RENMEI','YANGMEI','仁美倉','黑箱'),('WEISHI','YANGMEI','威獅倉','黑箱'),
 ('CHANGRONG','DAYUAN','長榮倉','橘箱'),('SHUIYUAN','DAYUAN','水源倉','橘箱'),('DAYUAN_SITE','DAYUAN','大園倉','橘箱');
ALTER TABLE delivery_orders ADD COLUMN pickup_point_id TEXT REFERENCES delivery_pickup_points(id), ADD COLUMN route_code TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_trips ADD COLUMN pickup_point_id TEXT REFERENCES delivery_pickup_points(id), ADD COLUMN pickup_point_name TEXT NOT NULL DEFAULT '', ADD COLUMN box_type TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_trip_stops ADD COLUMN route_code TEXT NOT NULL DEFAULT '';
CREATE INDEX delivery_orders_pickup_day ON delivery_orders(pickup_point_id,service_date);
