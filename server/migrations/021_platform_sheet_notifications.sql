-- Add missing change notifications without deleting or replacing business data.
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['drivers','vehicles','vehicle_maintenance_items','dispatch_staff','attendance_records','orders','shopee_routes','shopee_assignments','partner_fleets','fleet_routes','line_group_registry','line_fleet_groups','fleet_work_orders','fleet_incidents','fleet_incident_history','operational_incidents','penalty_rules','penalty_rule_history','penalty_cases','penalty_case_history','shopee_fleet_reports','line_keyword_replies','fleet_line_activity','delivery_stores','delivery_warehouses','delivery_pickup_points','delivery_orders','delivery_trips','delivery_trip_stops','delivery_route_claims','delivery_checkins','delivery_trip_returns','users','audit_logs','dispatch_source_fleet_aliases','source_catalog_batches','pickup_route_batches','dispatch_source_batches','line_driver_bindings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(n) AND tgfoid='wayan_notify_change()'::regprocedure AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER wayan_platform_sheet_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change()',n);
    END IF;
  END LOOP;
END $$;
