const crypto=require('node:crypto');
const {transaction,audit}=require('./transaction'),{assertStagingDatabase}=require('./stagingSafety'),{todayInTaipei}=require('./dates');
async function allowed(db,t,env=process.env){
 if(env.WAYAN_ENV!=='staging'||!t.is_simulated)return false;
 const r=(await db.query('SELECT value FROM settings WHERE key=$1',['route-acceptance:'+t.id])).rows[0];if(!r)return false;
 let p;try{p=JSON.parse(r.value);}catch{return false;}
 return p.fleetId===t.fleet_id&&p.date===t.service_date&&Date.now()<p.expiresAt;
}
async function setup(pool,env=process.env){
 if(!env.STAGING_ROUTE_ACCEPTANCE_REQUEST_ID)return {status:'disabled'};
 assertStagingDatabase(env);const requestId=env.STAGING_ROUTE_ACCEPTANCE_REQUEST_ID;
 if(!/^[a-f0-9-]{36}$/i.test(requestId)||env.STAGING_ROUTE_ACCEPTANCE_DATE!==todayInTaipei())throw Error('INVALID_ACCEPTANCE_REQUEST');
 return transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(870045)');await db.query('SELECT pg_advisory_xact_lock(870033)');
  const setting='route-acceptance-request:'+requestId,prior=(await db.query('SELECT value FROM settings WHERE key=$1',[setting])).rows[0];if(prior){const result=JSON.parse(prior.value),job=(await db.query("SELECT id,status,attempts,error_code,first_send_at FROM fleet_delivery_jobs WHERE payload->>'tripId'=$1 ORDER BY created_at DESC LIMIT 1",[result.tripId])).rows[0];if(job?.status==='failed'&&job.error_code==='SIMULATED_TASK_BLOCKED'&&!job.first_send_at&&!result.blockedRetryScheduled){const t=(await db.query('SELECT * FROM delivery_trips WHERE id=$1',[result.tripId])).rows[0];if(t&&await allowed(db,t,env)){await db.query("UPDATE fleet_delivery_jobs SET status='pending',attempts=0,error_code=NULL,locked_until=NULL,next_attempt_at=NOW()+INTERVAL '90 seconds' WHERE id=$1",[job.id]);result.blockedRetryScheduled=true;await db.query('UPDATE settings SET value=$2 WHERE key=$1',[setting,JSON.stringify(result)]);await audit(db,{username:'使用者授權測試',role:'admin'},'延後LINE驗收至新版接手','蝦皮門店車趟',t.id,'原job與LINE retry key保留，未送出且被舊模擬規則阻擋，僅重排一次');job.status='pending';job.attempts=0;job.error_code=null;}}return {...result,status:'existing',job};}
  const fleet=(await db.query("SELECT f.*,g.group_id FROM partner_fleets f JOIN line_fleet_groups g ON g.fleet_id=f.id JOIN line_group_registry r ON r.group_id=g.group_id WHERE f.id=$1 AND f.name=$2 AND f.status='啟用' AND r.bot_present=TRUE",[env.STAGING_ROUTE_ACCEPTANCE_FLEET_ID,env.STAGING_ROUTE_ACCEPTANCE_FLEET_NAME])).rows[0];if(!fleet)throw Error('VERIFIED_ACCEPTANCE_FLEET_REQUIRED');
  const batches=(await db.query("SELECT DISTINCT ON(kind) kind,records FROM source_catalog_batches WHERE kind IN ('NB','FN','WB') ORDER BY kind,id DESC")).rows;
  const choices=batches.flatMap(b=>b.records.filter(r=>!r.problems.length&&r.stops.length>0&&r.stops.length<=10));if(!choices.length)throw Error('NO_VERIFIED_ROUTE_TEMPLATE');
  const route=choices[crypto.randomInt(choices.length)],pickup=(await db.query('SELECT p.*,w.address FROM delivery_pickup_points p JOIN delivery_warehouses w ON w.id=p.warehouse_id WHERE p.box_type=$1 ORDER BY p.id LIMIT 1',[route.boxType])).rows[0];
  const code=route.routeCode[0]+'-TEST-'+requestId.slice(0,8).toUpperCase(),date=env.STAGING_ROUTE_ACCEPTANCE_DATE;
  const t=(await db.query(`INSERT INTO delivery_trips(request_id,request_hash,warehouse_id,service_date,departure_time,note,created_by,warehouse_address,task_code,task_name,required_checkins,pickup_point_id,pickup_point_name,box_type,is_simulated,fleet_id) VALUES($1,$2,$3,$4,'23:59','[模擬] 使用者授權安樺車隊LINE驗收，勿實際出車或計罰','驗收程序',$5,$6,$7,1,$8,$9,$10,TRUE,$11) RETURNING *`,[requestId,requestId,pickup.warehouse_id,date,pickup.address,code,'驗收測試（參考 '+route.routeCode+'）',pickup.id,pickup.name,pickup.box_type,fleet.id])).rows[0];
  for(const [i,s]of route.stops.entries()){
   const store=(await db.query("INSERT INTO delivery_stores(code,name,city,district,address,source,verified) VALUES($1,$2,$3,$4,$5,'測試路線快照，不作實際出車',TRUE) RETURNING id",[code+'-'+i,'[測試]'+s.name,s.city,s.district,s.address])).rows[0];
   const order=(await db.query("INSERT INTO delivery_orders(reference,warehouse_id,store_id,service_date,quantity,note,status,created_by,pickup_point_id,route_code) VALUES($1,$2,$3,$4,1,'[模擬] 件數1僅供驗收，不可實際出車','已安排','驗收程序',$5,$6) RETURNING id",[code+'-'+i,pickup.warehouse_id,store.id,date,pickup.id,code])).rows[0];
   await db.query('INSERT INTO delivery_trip_stops(trip_id,order_id,stop_no,store_code,store_name,city,district,address,route_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[t.id,order.id,i+1,code+'-'+i,'[測試]'+s.name,s.city,s.district,s.address,code]);
  }
  const noPush=env.STAGING_ROUTE_ACCEPTANCE_NO_PUSH==='yes';
  if(!noPush)await db.query('INSERT INTO settings(key,value) VALUES($1,$2)',['route-acceptance:'+t.id,JSON.stringify({fleetId:fleet.id,date,expiresAt:Date.now()+23*3600000})]);
  if(noPush)await db.query('INSERT INTO settings(key,value) VALUES($1,$2)',['quota-checkin:'+code,JSON.stringify({tripId:String(t.id),date})]);
  const actor={username:'使用者授權測試',role:'admin'};await audit(db,actor,'建立LINE路線驗收','蝦皮門店車趟',t.id,JSON.stringify({code,referenceRoute:route.routeCode}));
  if(!noPush){const queued=await require('./deliveryLine').queue(db,t,actor);if(queued.error)throw Error('ACCEPTANCE_QUEUE_REJECTED');await db.query("UPDATE fleet_delivery_jobs SET next_attempt_at=NOW()+INTERVAL '90 seconds' WHERE payload->>'tripId'=$1 AND first_send_at IS NULL",[String(t.id)]);}
  const result={status:'created',noPush,tripId:String(t.id),taskCode:code,referenceRouteCode:route.routeCode,date,stops:route.stops.length,fleetName:fleet.name};await db.query('INSERT INTO settings(key,value) VALUES($1,$2)',[setting,JSON.stringify(result)]);return result;
 });
}
module.exports={setup,allowed};
