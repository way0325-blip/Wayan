const crypto=require('node:crypto');
const {SOURCE_ID,hash}=require('./sourceCatalog');
const {isValidDateKey}=require('./dates');
const latest=async(db,kind)=>require('./sourceCatalog').projectRegions((await db.query('SELECT * FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,kind])).rows[0]);
async function buildTrip(db,kind,b,actor,logAction){
if(!['NB','FN','WB'].includes(kind)||!isValidDateKey(b.serviceDate)||b.verified!==true||typeof b.routeCode!=='string'||typeof b.pickupPointId!=='string')throw Object.assign(new Error('請核對門店、選有效日期、出發時間；固定路線以趟計價'),{status:400});
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 const batch=await require('./routeCarriers').attach(db,await latest(db,kind));if(!batch||String(batch.id)!==String(b.batchId))throw Object.assign(new Error('路線版本已變更，請重新載入'),{status:409});
 const route=batch.records.find(r=>r.routeCode===b.routeCode);if(!route||route.problems.length)throw Object.assign(new Error('路線不存在或尚有待核對問題，整條路線不拆除停靠站'),{status:409});
 b={...b,departureTime:b.departureTime||require('../public/routeCatalogGroups').timeWindow(route.timeWindow).start};if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.departureTime))throw Object.assign(new Error('請核對實際出發時間或來源時段'),{status:400});
 if(route.routeCode.length>31)throw Object.assign(new Error('路線編號過長，加入日期後超出LINE報到代碼限制，請先調整來源編號'),{status:400});
 const requested=b.stopOrder===undefined?route.stops.map(s=>s.sequence):b.stopOrder;
 if(!Array.isArray(requested)||requested.length!==route.stops.length||new Set(requested).size!==requested.length||requested.some(n=>!Number.isInteger(n)||!route.stops.some(s=>s.sequence===n)))throw Object.assign(new Error('停靠順序必須包含全部原路線站點，不得重複或遺漏'),{status:400});
 const orderedStops=requested.map(n=>route.stops.find(s=>s.sequence===n));
 const key=hash([SOURCE_ID,kind,route.routeCode,b.serviceDate]),taskCode=b.serviceDate.replace(/-/g,'')+'-'+route.routeCode;
 const old=(await db.query('SELECT trip_id FROM source_catalog_trip_links WHERE source_id=$1 AND kind=$2 AND route_code=$3 AND service_date=$4',[SOURCE_ID,kind,route.routeCode,b.serviceDate])).rows[0];
 if(old){const trip=(await db.query('SELECT * FROM delivery_trips WHERE id=$1',[old.trip_id])).rows[0],existingStops=(await db.query('SELECT o.quantity,o.reference FROM delivery_orders o JOIN delivery_trip_stops s ON s.order_id=o.id WHERE s.trip_id=$1 ORDER BY s.stop_no',[old.trip_id])).rows;if(trip.status==='已取消'||trip.pickup_point_id!==b.pickupPointId||trip.departure_time!==b.departureTime||existingStops.some((s,i)=>s.reference!=='SRC-'+key.slice(0,24)+'-'+orderedStops[i]?.sequence)||existingStops.length!==orderedStops.length)throw Object.assign(new Error('此日此路線已有不同安排或取消紀錄，請先查看既有車趟，不能重複建立'),{status:409});return {tripId:old.trip_id,taskCode:trip.task_code,duplicate:true};}
 const pickup=(await db.query('SELECT p.*,w.address AS warehouse_address FROM delivery_pickup_points p JOIN delivery_warehouses w ON w.id=p.warehouse_id WHERE p.id=$1',[b.pickupPointId])).rows[0];
 if(!pickup||pickup.box_type!==route.boxType)throw Object.assign(new Error('取貨點箱型不符：N／F大園橘箱，W楊梅黑箱'),{status:400});
 const trip=(await db.query(`INSERT INTO delivery_trips(request_id,request_hash,warehouse_id,service_date,departure_time,note,created_by,warehouse_address,task_code,task_name,required_checkins,pickup_point_id,pickup_point_name,box_type,source_fleet_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) RETURNING *`,[crypto.randomUUID(),key,pickup.warehouse_id,b.serviceDate,b.departureTime,'來源路線範本；司機與車隊由調度彈性指派',actor.username,pickup.warehouse_address,taskCode,route.routeCode+' '+route.serviceType,pickup.id,pickup.name,pickup.box_type,route.sourceFleetName||''])).rows[0];
 for(const [index,stop] of orderedStops.entries()){
  const storeCode='SRC-'+hash([stop.name,stop.address]).slice(0,24).toUpperCase();
  let store=(await db.query('SELECT * FROM delivery_stores WHERE code=$1',[storeCode])).rows[0];
  if(store&&(!store.active||!store.verified||store.name!==stop.name||store.address!==stop.address))throw Object.assign(new Error('門店已停用、尚未核對或資料衝突，請先人工核對'),{status:409});
  if(!store)store=(await db.query('INSERT INTO delivery_stores(code,name,city,district,address,source,verified) VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING *',[storeCode,stop.name,stop.city,stop.district,stop.address,`https://docs.google.com/spreadsheets/d/${SOURCE_ID}/edit#gid=${batch.sheet_id}`])).rows[0];
  const order=(await db.query("INSERT INTO delivery_orders(reference,warehouse_id,store_id,service_date,quantity,note,status,created_by,pickup_point_id,route_code) VALUES($1,$2,$3,$4,$5,$6,'已安排',$7,$8,$9) RETURNING id",['SRC-'+key.slice(0,24)+'-'+stop.sequence,pickup.warehouse_id,store.id,b.serviceDate,null,stop.note,actor.username,pickup.id,route.routeCode])).rows[0];
  await db.query('INSERT INTO delivery_trip_stops(trip_id,order_id,stop_no,store_code,store_name,city,district,address,route_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[trip.id,order.id,index+1,store.code,stop.name,stop.city,stop.district,stop.address,route.routeCode]);
 }
 await db.query('INSERT INTO source_catalog_trip_links(source_id,kind,route_code,service_date,batch_id,trip_id) VALUES($1,$2,$3,$4,$5,$6)',[SOURCE_ID,kind,route.routeCode,b.serviceDate,batch.id,trip.id]);
 await logAction('來源路線建立車趟','蝦皮門店車趟',trip.id,`${route.routeCode} ${route.stops.length}站；來源批次${batch.id}；原站序${requested.join(',')}；尚未派車及發送LINE`);
 return {tripId:trip.id,taskCode:trip.task_code,stops:route.stops.length};
}
module.exports={buildTrip};
