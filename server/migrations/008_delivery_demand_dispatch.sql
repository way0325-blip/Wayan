ALTER TABLE delivery_trips ADD COLUMN demand_route_id TEXT REFERENCES shopee_routes(id);
ALTER TABLE delivery_trips ADD CONSTRAINT delivery_demand_one_vehicle CHECK(demand_route_id IS NULL OR required_checkins=1);
CREATE INDEX delivery_trips_demand ON delivery_trips(demand_route_id);
ALTER TABLE shopee_assignments ADD COLUMN delivery_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE delivery_trips ADD COLUMN is_simulated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shopee_routes ADD COLUMN is_simulated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE partner_fleets ADD COLUMN is_simulated BOOLEAN NOT NULL DEFAULT FALSE;
