const crypto=require('node:crypto');
const {assertStagingDatabase}=require('./stagingSafety');
const {usedCapacity}=require('./fleetOperations');
const {todayInTaipei,isValidDateKey}=require('./dates');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{dispatchStatus:status});};
const clean=v=>typeof v==='string'?v.trim():'';
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v||'');
const tripVersion="to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
async function board(db,day,fleet=''){
 const trips=(await db.query(`SELECT t.*,(SELECT alias FROM delivery_checkin_aliases WHERE trip_id=t.id) AS checkin_code,${tripVersion} AS dispatch_version,w.name AS warehouse_name,f.name AS fleet_name,d.name AS driver_name,v.plate,g.group_id,r.label AS group_name,
 (SELECT count(*)::int FROM delivery_checkins c WHERE c.trip_id=t.id) AS checked_in,
 (SELECT count(*)::int FROM delivery_trip_stops s WHERE s.trip_id=t.id) AS order_count
 FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id LEFT JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN line_fleet_groups g ON g.fleet_id=t.fleet_id LEFT JOIN line_group_registry r ON r.group_id=g.group_id
 WHERE t.service_date=$1 AND ($2='' OR t.fleet_id=$2) ORDER BY t.demand_route_id,t.task_code LIMIT 1000`,[day,fleet])).rows;
 const routes=(await db.query(`SELECT r.* FROM shopee_routes r WHERE r.service_date=$1 ORDER BY r.destination LIMIT 1000`,[day])).rows;
 return {date:day,trips,routes:routes.map(r=>{const list=trips.filter(t=>t.demand_route_id===r.id&&t.status!=='已取消');return {...r,visible_trips:list.length,assigned:list.filter(t=>t.fleet_id||t.driver_id).length,own:list.filter(t=>t.driver_id&&!t.fleet_id).length,reported:list.reduce((n,t)=>n+t.checked_in,0)};}),truncated:trips.length===1000};
}
async function ownCount(db,routeId){return Number((await db.query("SELECT count(*) n FROM delivery_trips WHERE demand_route_id=$1 AND driver_id IS NOT NULL AND fleet_id IS NULL AND status<>'已取消'",[routeId])).rows[0].n);}
async function syncFleetAcceptance(db,id,actor){
 const a=(await db.query('SELECT * FROM shopee_assignments WHERE id=$1',[id])).rows[0];if(!a||a.status!=='已確認')return;
 const rows=(await db.query("UPDATE delivery_trips SET status='已派車',updated_at=clock_timestamp() WHERE assignment_id=$1 AND demand_route_id IS NOT NULL AND fleet_id=$2 AND status='待派車' RETURNING id",[a.id,a.fleet_id])).rows;
 for(const t of rows)await require('./transaction').audit(db,actor,'車隊承接同步派車','蝦皮門店車趟',t.id,'承接編號'+a.id);
}
async function syncAssignments(db,routeId,actor){
 const route=(await db.query('SELECT * FROM shopee_routes WHERE id=$1 FOR UPDATE',[routeId])).rows[0];if(!route)fail('路線需求不存在');
 const all=(await db.query("SELECT * FROM delivery_trips WHERE demand_route_id=$1 AND status<>'已取消'",[routeId])).rows;
 if(all.length>route.required_trucks)fail('車趟數超過路線合計需求車數');
 const assignments=(await db.query('SELECT * FROM shopee_assignments WHERE route_id=$1 FOR UPDATE',[routeId])).rows;
 const fleetIds=new Set([...all.map(t=>t.fleet_id).filter(Boolean),...assignments.filter(a=>a.delivery_managed).map(a=>a.fleet_id)]);
 for(const fleetId of fleetIds){
  const list=all.filter(t=>t.fleet_id===fleetId),n=list.length,a=assignments.find(a=>a.fleet_id===fleetId);
  if(a&&!a.delivery_managed){if(!n)continue;if(a.status==='已拒絕'||n>(a.status==='已確認'?a.confirmed_trucks:a.requested_trucks))fail('超過既有車隊承接數，請先在蝦皮任務派單調整');await db.query('UPDATE delivery_trips SET assignment_id=$2 WHERE demand_route_id=$1 AND fleet_id=$3 AND status<>\'已取消\'',[routeId,a.id,fleetId]);await syncFleetAcceptance(db,a.id,actor);continue;}
  if(a&&a.requested_trucks===n&&a.status!=='已拒絕'){await db.query("UPDATE delivery_trips SET assignment_id=$2 WHERE demand_route_id=$1 AND fleet_id=$3 AND status<>'已取消'",[routeId,a.id,fleetId]);await syncFleetAcceptance(db,a.id,actor);continue;}
  if(a&&(await db.query("SELECT 1 FROM delivery_trips t WHERE t.assignment_id=$1 AND (t.status IN ('配送中','已完成') OR EXISTS(SELECT 1 FROM delivery_checkins c WHERE c.trip_id=t.id)) LIMIT 1",[a.id])).rowCount)fail('此承接已有配送或報到，請由主管處理後再調整數量');
  if(Number(await require('./shopeeCheckins').reportedTotal(db,fleetId,route.service_date))>0)fail('車隊已有當日報到總數，請先由主管核對再調整');
  if(!n){if(a)await db.query("UPDATE shopee_assignments SET status='已拒絕',confirmed_trucks=0,updated_at=clock_timestamp() WHERE id=$1",[a.id]);continue;}
  const cap=(await db.query('SELECT max_trucks FROM fleet_routes WHERE fleet_id=$1 AND origin=$2 AND destination=$3 AND vehicle_type=$4 AND active=TRUE',[fleetId,route.origin,route.destination,route.vehicle_type])).rows[0];
  if(!cap||n>cap.max_trucks)fail('車隊未設定此路線或超過路線承接上限，請先設定車隊可承接路線');
  const item=(await db.query(`INSERT INTO shopee_assignments(route_id,fleet_id,requested_trucks,delivery_managed) VALUES($1,$2,$3,TRUE) ON CONFLICT(route_id,fleet_id) DO UPDATE SET requested_trucks=EXCLUDED.requested_trucks,confirmed_trucks=0,status='待回覆',updated_at=clock_timestamp() RETURNING id`,[routeId,fleetId,n])).rows[0];
  await db.query("UPDATE delivery_trips SET assignment_id=$2,status=CASE WHEN status='已派車' THEN '待派車' ELSE status END,updated_at=clock_timestamp() WHERE demand_route_id=$1 AND fleet_id=$3 AND status<>'已取消'",[routeId,item.id,fleetId]);
 }
 const reserved=Number((await db.query("SELECT COALESCE(SUM(CASE WHEN status='已確認' THEN confirmed_trucks ELSE requested_trucks END),0) n FROM shopee_assignments WHERE route_id=$1 AND status<>'已拒絕'",[routeId])).rows[0].n);
 if(reserved+all.filter(t=>t.driver_id&&!t.fleet_id).length>route.required_trucks)fail('車隊承接與自有車合計超過路線需求');
}
async function assign(db,body,actor,audit){
 const {items}=body||{},reason=clean(body?.reason);
 if(!reason||reason.length>500||!Array.isArray(items)||!items.length||items.length>50||new Set(items.map(x=>String(x?.tripId))).size!==items.length)fail('需1～50個不重複車趟及調整原因',400);
 for(const x of items)if(!x||typeof x!=='object'||(x.routeId!==undefined&&(typeof x.routeId!=='string'||x.routeId.length>100))||['fleetId','driverId','vehicleId','groupId'].some(k=>x[k]!==undefined&&(typeof x[k]!=='string'||x[k].length>100))||!/^\d{1,15}$/.test(String(x.tripId))||typeof x.version!=='string'||x.version.length>40||!['pending','fleet','own'].includes(x.mode)||(x.mode==='fleet'&&(!clean(x.fleetId)||x.driverId||x.vehicleId))||(x.mode==='own'&&(!clean(x.driverId)||!clean(x.vehicleId)||x.fleetId||x.groupId))||(x.mode==='pending'&&(x.fleetId||x.driverId||x.vehicleId||x.groupId)))fail('分派資料格式錯誤：車隊與自有車不可混用',400);
 await db.query('SELECT pg_advisory_xact_lock(870032)');
 const before=(await db.query(`SELECT t.*,${tripVersion} AS dispatch_version FROM delivery_trips t WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`,[items.map(x=>x.tripId)])).rows;
 if(before.length!==items.length)fail('車趟不存在');
 const routes=new Set(),capacity=new Set(),oldDrivers=new Set(),oldVehicles=new Set();
 for(const t of before){const x=items.find(x=>String(x.tripId)===String(t.id));if(x.version!==t.dispatch_version)fail('車趟已被更新，請重新整理後再分派');if(!['待派車','已派車'].includes(t.status))fail('只有未出發車趟可調整');if((await db.query('SELECT 1 FROM delivery_checkins WHERE trip_id=$1 LIMIT 1',[t.id])).rowCount)fail('車趟已有報到，請先由主管處理');if(t.assignment_id&&!t.demand_route_id)fail('此車趟已有舊版需求連結，請使用原分派流程');if(t.demand_route_id)routes.add(t.demand_route_id);if(t.fleet_id)capacity.add(JSON.stringify([t.fleet_id,t.service_date]));oldDrivers.add(t.driver_id);oldVehicles.add(t.vehicle_id);}
 // Clear only this transaction's selected plans, then validate the final plan atomically.
 await db.query("UPDATE delivery_trips SET fleet_id=NULL,driver_id=NULL,vehicle_id=NULL,assignment_id=NULL,status='待派車' WHERE id=ANY($1::bigint[])",[items.map(x=>x.tripId)]);
 for(const t of before){const x=items.find(x=>String(x.tripId)===String(t.id));
  let demandRoute;const routeId=x.routeId===undefined?t.demand_route_id:clean(x.routeId)||null;if(routeId){const r=(await db.query('SELECT r.* FROM shopee_routes r JOIN delivery_warehouses w ON w.name=r.origin WHERE r.id=$1 AND w.id=$2 AND r.service_date=$3',[routeId,t.warehouse_id,t.service_date])).rows[0];if(!r||t.required_checkins!==1)fail('路線需求須同作業日、取貨倉且每個車趟需求報到為1');demandRoute=r;routes.add(routeId);}await db.query('UPDATE delivery_trips SET demand_route_id=$2 WHERE id=$1',[t.id,routeId]);
  if(x.mode==='fleet'){
   const f=(await db.query("SELECT * FROM partner_fleets WHERE id=$1 AND status='啟用'",[x.fleetId])).rows[0];if(!f)fail('車隊不存在或已停用');
   if(x.groupId&&!(await db.query('SELECT 1 FROM line_fleet_groups g JOIN line_group_registry r ON r.group_id=g.group_id WHERE g.fleet_id=$1 AND g.group_id=$2 AND r.bot_present=TRUE',[f.id,x.groupId])).rowCount)fail('派車群組不是此車隊已驗證綁定的群組');
   await db.query('UPDATE delivery_trips SET fleet_id=$2 WHERE id=$1',[t.id,f.id]);capacity.add(JSON.stringify([f.id,t.service_date]));
  }else if(x.mode==='own'){
   const d=(await db.query('SELECT * FROM drivers WHERE id=$1 FOR UPDATE',[x.driverId])).rows[0],v=(await db.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE',[x.vehicleId])).rows[0];
   if(demandRoute&&v&&v.type!==demandRoute.vehicle_type)fail('自有車輛車型與路線需求不符');
   if(!d||!v||(d.status!=='可派車'&&!(oldDrivers.has(d.id)&&d.status==='執行中'))||(v.status!=='可用'&&!(oldVehicles.has(v.id)&&v.status==='執行中'))||d.license<t.service_date||v.maintenance<t.service_date||(v.inspection_date&&v.inspection_date<t.service_date))fail('司機或車輛不可用，或證照／保養已逾期');
   if((await db.query("SELECT 1 FROM attendance_records WHERE staff_type='driver' AND staff_id=$1 AND date=$2 AND status IN ('休假','曠職')",[d.id,t.service_date])).rowCount)fail('司機當日休假或曠職');
   if((await db.query("SELECT 1 FROM delivery_trips WHERE status IN ('已派車','配送中') AND (driver_id=$1 OR vehicle_id=$2) UNION ALL SELECT 1 FROM orders WHERE status IN ('已派車','執行中') AND (driver_id=$1 OR vehicle_id=$2) LIMIT 1",[d.id,v.id])).rowCount)fail('司機或車輛已有未完成車趟，不可重複派車');
   await db.query("UPDATE delivery_trips SET driver_id=$2,vehicle_id=$3,status='已派車' WHERE id=$1",[t.id,d.id,v.id]);await db.query("UPDATE drivers SET status='執行中' WHERE id=$1",[d.id]);await db.query("UPDATE vehicles SET status='執行中' WHERE id=$1",[v.id]);
  }
  await db.query('UPDATE delivery_trips SET updated_at=clock_timestamp() WHERE id=$1',[t.id]);
 }
 for(const r of routes)await syncAssignments(db,r,actor);
 for(const pair of capacity){const [fleetId,day]=JSON.parse(pair),f=(await db.query('SELECT * FROM partner_fleets WHERE id=$1',[fleetId])).rows[0];if(f.daily_capacity>0&&Number(await usedCapacity(db,fleetId,day))>f.daily_capacity)fail('超過車隊當日承接上限');}
 for(const id of oldDrivers)if(id)await db.query("UPDATE drivers SET status='可派車' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM delivery_trips WHERE driver_id=$1 AND status IN ('已派車','配送中')) AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))",[id]);
 for(const id of oldVehicles)if(id)await db.query("UPDATE vehicles SET status='可用' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM delivery_trips WHERE vehicle_id=$1 AND status IN ('已派車','配送中')) AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))",[id]);
 for(const t of before){const next=(await db.query('SELECT * FROM delivery_trips WHERE id=$1',[t.id])).rows[0];await audit(actor,'調整路線車趟分派','蝦皮門店車趟',t.id,JSON.stringify({reason,before:{fleet:t.fleet_id,driver:t.driver_id,vehicle:t.vehicle_id},after:{fleet:next.fleet_id,driver:next.driver_id,vehicle:next.vehicle_id}}));}
 return {updated:before.length};
}
async function simulate(db,body,actor,audit){
 try{assertStagingDatabase();}catch{fail('虛擬訂單只允許獨立測試環境',403);}
 const day=body?.date||todayInTaipei(),requestId=body?.requestId;if(!uuid(requestId)||!isValidDateKey(day))fail('需有效日期及唯一請求編號',400);
 const key='delivery-demo:'+requestId,prior=(await db.query('SELECT value FROM settings WHERE key=$1',[key])).rows[0];if(prior){const old=JSON.parse(prior.value);if(old.date!==day)fail('同一請求編號日期不同');return {...old,duplicate:true};}
 const daily=(await db.query('SELECT value FROM settings WHERE key=$1',['delivery-demo-current:'+day])).rows[0];if(daily)return {...JSON.parse(daily.value),duplicate:true};
 const prefix='SIM'+requestId.replaceAll('-','').toUpperCase(),fleetIds=[],driverIds=[],vehicleIds=[];
 for(let i=0;i<2;i++){const f=prefix+'F'+i,d=prefix+'D'+i,v=prefix+'V'+i;await db.query("INSERT INTO partner_fleets(id,name,daily_capacity,note,is_simulated) VALUES($1,$2,30,'[模擬]不對外發送',TRUE)",[f,'[模擬]'+(i?'乙':'甲')+'車隊']);await db.query("INSERT INTO drivers(id,name,phone,license) VALUES($1,$2,'未提供（模擬）','2099-12-31')",[d,'[模擬]自有司機'+(i+1)]);await db.query("INSERT INTO vehicles(id,plate,type,maintenance) VALUES($1,$2,'11T','2099-12-31')",[v,'SIM-'+prefix.slice(-4)+'-'+i]);fleetIds.push(f);driverIds.push(d);vehicleIds.push(v);}
 const specs=[{name:'桃園楊梅線',warehouse:'YANGMEI',district:'楊梅區',other:'中壢區',n:10},{name:'桃園觀音線',warehouse:'GUANYIN',district:'觀音區',other:'大園區',n:10},{name:'桃園大園線',warehouse:'DAYUAN',district:'大園區',other:'蘆竹區',n:10}],routeIds=[],tripIds=[];
 for(let r=0;r<specs.length;r++){const s=specs[r],route=prefix+'R'+r,warehouse=(await db.query('SELECT * FROM delivery_warehouses WHERE id=$1',[s.warehouse])).rows[0];await db.query("INSERT INTO shopee_routes(id,service_date,origin,destination,vehicle_type,required_trucks,note,is_simulated) VALUES($1,$2,$3,$4,'11T',$5,'[模擬]路線合計需求，非真實訂單',TRUE)",[route,day,warehouse.name,s.name,s.n]);routeIds.push(route);for(const f of fleetIds)await db.query("INSERT INTO fleet_routes(fleet_id,origin,destination,vehicle_type,max_trucks) VALUES($1,$2,$3,'11T',30)",[f,warehouse.name,s.name]);const stores=[];
  for(let z=0;z<2;z++){const store=(await db.query("INSERT INTO delivery_stores(code,name,city,district,address,source,verified) VALUES($1,$2,'桃園市',$3,'虛擬地址，非真實門店，禁止導航','[模擬]使用者授權驗收資料',TRUE) RETURNING id",[prefix+'S'+r+z,'[模擬]'+s.name+'門店'+(z+1),z?s.other:s.district])).rows[0];stores.push(store.id);}
  for(let i=0;i<s.n;i++){const label=i<26?String.fromCharCode(65+i):String(i+1),t=(await db.query("INSERT INTO delivery_trips(request_id,request_hash,warehouse_id,service_date,departure_time,created_by,task_code,task_name,required_checkins,note,demand_route_id,is_simulated) VALUES($1,'demo',$2,$3,'09:00',$4,$5,$6,1,'[模擬]禁止對外LINE通知',$7,TRUE) RETURNING id",[crypto.randomUUID(),s.warehouse,day,actor.username,prefix+'-'+r+'-'+label,s.name+' '+label+'車',route])).rows[0];tripIds.push(t.id);
   for(let z=0;z<2;z++){const o=(await db.query("INSERT INTO delivery_orders(reference,warehouse_id,store_id,service_date,quantity,note,status,created_by) VALUES($1,$2,$3,$4,5,'[模擬]非真實配送','已安排',$5) RETURNING id",[prefix+'O'+r+'-'+i+'-'+z,s.warehouse,stores[z],day,actor.username])).rows[0];await db.query("INSERT INTO delivery_trip_stops(trip_id,order_id,stop_no,store_code,store_name,city,district,address) SELECT $1,$2,$3,code,name,city,district,address FROM delivery_stores WHERE id=$4",[t.id,o.id,z+1,stores[z]]);}
  }
 }
 const result={date:day,prefix,routeIds,tripIds,fleetIds,driverIds,vehicleIds,routes:3,requiredTrucks:30,trips:30,orders:60};await db.query('INSERT INTO settings(key,value) VALUES($1,$2)',[key,JSON.stringify(result)]);await db.query('INSERT INTO settings(key,value) VALUES($1,$2)',['delivery-demo-current:'+day,JSON.stringify(result)]);await db.query("UPDATE fleet_delivery_jobs SET status='blocked',error_code='SIMULATED_TASK_BLOCKED' WHERE job_key=ANY($1::text[])",[fleetIds.map(f=>'sheet:fleets:'+f)]);await audit(actor,'建立模擬路線訂單','測試資料',prefix,'3路線合計30車、60筆訂單；未指派、不通知LINE');return result;
}
function register(router,db,logAction,admin){const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.dispatchStatus)return res.status(e.dispatchStatus).json({error:e.message});next(e);}};
 router.get('/dispatch-board',wrap(async(req,res)=>{const day=req.query.date||todayInTaipei(),fleet=req.query.fleetId||'';if(!isValidDateKey(day)||typeof fleet!=='string'||fleet.length>100)fail('日期或車隊格式錯誤',400);res.set('Cache-Control','no-store').json(await board(db,day,fleet));}));
 router.get('/dispatch-options',wrap(async(req,res)=>{let demoAllowed=true;try{assertStagingDatabase();}catch{demoAllowed=false;}res.set('Cache-Control','no-store').json({demoAllowed,warehouses:(await db.query('SELECT id,name FROM delivery_warehouses ORDER BY id')).rows,vehicleTypes:(await require('./settings').getSettings()).shopee_vehicle_types,fleets:(await db.query('SELECT f.id,f.name,f.status,g.group_id,r.label AS group_name,r.bot_present FROM partner_fleets f LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id LEFT JOIN line_group_registry r ON r.group_id=g.group_id ORDER BY f.name')).rows,drivers:(await db.query('SELECT id,name,status FROM drivers ORDER BY name')).rows,vehicles:(await db.query('SELECT id,plate,status FROM vehicles ORDER BY plate')).rows});}));
 router.post('/dispatch-plan',wrap(async(req,res)=>res.json(await assign(db,req.body,req.user,(actor,...args)=>logAction(req,...args)))));
 router.post('/demo-orders',admin,wrap(async(req,res)=>res.status(201).json(await simulate(db,req.body,req.user,(actor,...args)=>logAction(req,...args)))));
}
module.exports={register,board,assign,simulate,syncAssignments,ownCount,syncFleetAcceptance};
