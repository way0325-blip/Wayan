// Added to the existing SELECT so all dashboard metrics share one database snapshot.
module.exports=`
 (SELECT json_build_object('orders',count(*),'pendingOrders',count(*) FILTER(WHERE status='待安排'),
 'deliveredOrders',count(*) FILTER(WHERE status='已送達'),'cancelledOrders',count(*) FILTER(WHERE status='已取消'),
 'pieces',coalesce(sum(quantity) FILTER(WHERE status<>'已取消'),0)) FROM delivery_orders WHERE service_date=$1) AS "deliveryOrders",
 (SELECT json_build_object('total',count(*) FILTER(WHERE t.status<>'已取消'),
 'pending',count(*) FILTER(WHERE t.status='待派車'),'active',count(*) FILTER(WHERE t.status IN ('已派車','配送中')),
 'completed',count(*) FILTER(WHERE t.status='已完成'),'cancelled',count(*) FILTER(WHERE t.status='已取消'),
 'required',coalesce(sum(t.required_checkins) FILTER(WHERE t.status<>'已取消'),0),
 'reported',coalesce(sum(c.n) FILTER(WHERE t.status<>'已取消'),0),
 'shortage',coalesce(sum(greatest(t.required_checkins-c.n,0)) FILTER(WHERE t.status<>'已取消'),0),
 'simulated',count(*) FILTER(WHERE t.is_simulated AND t.status<>'已取消'),
 'withoutPickup',count(*) FILTER(WHERE t.pickup_point_id IS NULL AND t.status<>'已取消'))
 FROM delivery_trips t CROSS JOIN LATERAL(SELECT count(*)::int n FROM delivery_active_checkins WHERE trip_id=t.id)c WHERE t.service_date=$1) AS "deliveryTrips",
 (SELECT json_build_object('open',count(*) FILTER(WHERE status<>'已結案'),'urgent',count(*) FILTER(WHERE status<>'已結案' AND severity='緊急')) FROM fleet_incidents) AS "fleetIncidents",
 (SELECT json_build_object('pending',count(*) FILTER(WHERE status='待覆核'),'appealing',count(*) FILTER(WHERE status='申訴中'),
 'confirmed',count(*) FILTER(WHERE status='已確認' AND reviewer<>'' AND amount IS NOT NULL AND points IS NOT NULL),
 'amount',coalesce(sum(amount) FILTER(WHERE status='已確認' AND reviewer<>'' AND amount IS NOT NULL AND points IS NOT NULL),0),
 'points',coalesce(sum(points) FILTER(WHERE status='已確認' AND reviewer<>'' AND amount IS NOT NULL AND points IS NOT NULL),0)) FROM penalty_cases) AS "penaltySummary",
 (SELECT json_build_object('active',count(*),'bound',count(*) FILTER(WHERE g.group_id IS NOT NULL)) FROM partner_fleets f LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id WHERE f.status='啟用' AND NOT f.is_simulated) AS "fleetConnections",
 (SELECT json_build_object('failed',count(*) FILTER(WHERE status IN ('failed','blocked')),'pending',count(*) FILTER(WHERE status IN ('pending','processing'))) FROM fleet_delivery_jobs) AS "deliverySync",
 (SELECT coalesce(json_agg(x ORDER BY x.warehouse_id,x.name),'[]'::json) FROM(
 SELECT p.id,p.name,p.box_type,p.warehouse_id,w.name AS warehouse_name,count(t.id)::int AS trips,
 count(t.id) FILTER(WHERE t.status='已完成')::int AS completed
 FROM delivery_pickup_points p JOIN delivery_warehouses w ON w.id=p.warehouse_id
 LEFT JOIN delivery_trips t ON t.pickup_point_id=p.id AND t.service_date=$1 AND t.status<>'已取消'
 GROUP BY p.id,w.name)x) AS "pickupActivity",
 (SELECT coalesce(json_agg(x ORDER BY x.id DESC),'[]'::json) FROM(
 SELECT t.id,t.task_code,t.task_name,t.departure_time,t.status,t.pickup_point_name,t.box_type,w.name AS warehouse_name,
 f.name AS fleet_name,d.name AS driver_name,t.is_simulated,t.required_checkins,
 (SELECT count(*)::int FROM delivery_active_checkins WHERE trip_id=t.id) AS checked_in
 FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id LEFT JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN drivers d ON d.id=t.driver_id
 WHERE t.service_date=$1 ORDER BY t.id DESC LIMIT 8)x) AS "recentDeliveryTrips",
 (SELECT coalesce(json_agg(x ORDER BY x.id DESC),'[]'::json) FROM(
 SELECT i.id,i.kind,i.status,i.severity,i.description,i.created_at,f.name AS fleet_name
 FROM fleet_incidents i JOIN partner_fleets f ON f.id=i.fleet_id WHERE i.status<>'已結案' ORDER BY i.id DESC LIMIT 6)x) AS "recentFleetIncidents"
`;
