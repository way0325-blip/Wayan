const crypto=require('node:crypto');
const {SOURCE_ID}=require('./sourceCatalog');
const {todayInTaipei,isValidDateKey}=require('./dates');
const {audit}=require('./transaction');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{claimStatus:status});};
const managed=t=>!t.is_simulated&&t.driver_claim_required===true;
async function rosterRecord(db,code,row){
 const batch=(await db.query('SELECT records FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,'drivers'])).rows[0];
 const matches=(batch?.records||[]).filter(r=>r.externalDriverId===code);
 if(matches.length!==1||row!==undefined&&Number(matches[0].sourceRow)!==Number(row)||matches[0].problems.length)fail('司機編號不存在、不唯一或資料尚待核對，請由管理員確認名冊');
 return matches[0];
}
async function createRosterCode(db,body,actor){
 if(body?.verified!==true||typeof body.driverCode!=='string'||!body.driverCode.trim()||body.driverCode.length>100||!Number.isInteger(body.sourceRow))fail('請核對來源司機編號與資料列',400);
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 const r=await rosterRecord(db,body.driverCode.trim(),body.sourceRow);
 if(!r.name||r.name.length>50||(r.phone||'').length>30||!isValidDateKey(r.license))fail('姓名、電話或證照期限須先核對');
 let d=(await db.query('SELECT * FROM drivers WHERE roster_source_id=$1 AND roster_driver_id=$2 FOR UPDATE',[SOURCE_ID,r.externalDriverId])).rows[0];
 if(!d)d=(await db.query("INSERT INTO drivers(id,name,phone,license,status,roster_source_id,roster_source_row,roster_driver_id) VALUES($1,$2,$3,$4,'可派車',$5,$6,$7) RETURNING *",['SRC-'+hash(SOURCE_ID+':'+r.externalDriverId).slice(0,20).toUpperCase(),r.name,r.phone||'',r.license,SOURCE_ID,r.sourceRow,r.externalDriverId])).rows[0];
 if((await db.query('SELECT 1 FROM line_driver_bindings WHERE driver_id=$1',[d.id])).rowCount)fail('此司機已綁定，請先解除舊LINE綁定再換人');
 await db.query('UPDATE drivers SET name=$2,phone=$3,license=$4,roster_source_row=$5 WHERE id=$1',[d.id,r.name,r.phone||'',r.license,r.sourceRow]);
 const code=crypto.randomBytes(16).toString('base64url');
 const result=(await db.query("INSERT INTO line_binding_codes(code_hash,driver_id,expires_at,created_by) VALUES($1,$2,NOW()+INTERVAL '10 minutes',$3) ON CONFLICT(driver_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by RETURNING expires_at",[hash(code),d.id,actor.username])).rows[0];
 await audit(db,actor,'核對來源司機並產生LINE綁定碼','LINE',d.id,'來源列'+r.sourceRow+'；司機ID '+r.externalDriverId+'；10分鐘有效，舊碼失效');
 return {code,driverCode:r.externalDriverId,driverRuntimeId:d.id,expiresAt:result.expires_at};
}
async function identity(db,userId,code){
 const d=(await db.query('SELECT d.* FROM line_driver_bindings b JOIN drivers d ON d.id=b.driver_id WHERE b.line_user_id=$1 FOR SHARE OF b,d',[userId])).rows[0];
 if(!d)fail('請先私訊Bot，以管理員提供的一次性代碼綁定司機；輸入司機ID本身不能驗證身分');
 const publicCode=d.roster_driver_id||d.id;if(code!==undefined&&code!==publicCode)fail('司機ID與目前LINE綁定身分不符');
 if(d.status==='停派')fail('此司機已停派，請聯絡調度');
 if(d.roster_source_id){if(d.roster_source_id!==SOURCE_ID)fail('來源司機名冊不符');const r=await rosterRecord(db,d.roster_driver_id,d.roster_source_row);if(r.name!==d.name)fail('來源司機資料已變更，需重新核對身分');if(!isValidDateKey(r.license)||r.license<todayInTaipei())fail('司機證照已逾期或待核對，請聯絡管理員');}
 else if(!isValidDateKey(d.license)||d.license<todayInTaipei())fail('司機證照已逾期或待核對，請聯絡管理員');
 return {...d,publicCode};
}
async function active(db,tripId){return (await db.query('SELECT * FROM delivery_route_claims WHERE trip_id=$1 AND revoked_at IS NULL',[tripId])).rows[0];}
async function verifyOwner(db,t,userId){const d=await identity(db,userId),c=await active(db,t.id);if(!c)fail('請先在車隊群組輸入「接取 路線編號 司機ID」，確認接取後再報到');if(c.driver_id!==d.id||c.reporter_hash!==hash(userId))fail('此車趟不是目前LINE帳號已接取的路線');return {driver:d,claim:c};}
const ack=(t,c)=>'路線 '+c.route_code+' 接取成功。\n作業日期：'+c.service_date+'\n出車時段：'+c.departure_time+'\n總共 '+c.stop_count+' 個點\n司機ID：'+c.driver_code+'\n請私訊本Bot「我的路線 '+t.task_code+'」取得完整站點。\n報到：車趟報到 '+t.task_code;
async function ownTrip(db,key,driverId){const rows=(await db.query("SELECT t.*,w.name AS warehouse_name FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id WHERE t.driver_id=$1 AND t.fleet_id IS NULL AND t.service_date=$3 AND (upper(t.task_code)=$2 OR EXISTS(SELECT 1 FROM delivery_trip_stops s WHERE s.trip_id=t.id AND upper(s.route_code)=$2)) LIMIT 2 FOR UPDATE OF t",[driverId,String(key).toUpperCase(),todayInTaipei()])).rows;return rows.length===1?rows[0]:null;}
async function claimRoute(db,text,fleet,userId,eventId){
 const m=String(text||'').normalize('NFKC').trim().match(/^(?:接取|接取路線)\s+([\p{Script=Han}A-Za-z0-9_-]{1,40})\s+([^\s]{1,100})$/u);if(!m)return null;
 await db.query('SELECT pg_advisory_xact_lock(870033)');
  if(fleet&&fleet.status&&fleet.status!=='啟用')fail('車隊已停用，請聯絡調度');
  const d=await identity(db,userId,m[2]),t=fleet?await require('./deliveryAliases').resolve(db,m[1],fleet.id,true):await ownTrip(db,m[1],d.id);
  if(!t||t.service_date!==todayInTaipei()||!['待派車','已派車'].includes(t.status)||t.is_simulated||!managed(t))fail('找不到今日可接取的正式固定路線；模擬與舊版車趟不走司機接取流程');
  const stops=(await db.query('SELECT * FROM delivery_trip_stops WHERE trip_id=$1 AND released_at IS NULL ORDER BY stop_no',[t.id])).rows,routes=[...new Set(stops.map(s=>String(s.route_code||'').trim().toUpperCase()))];
  if(t.required_checkins!==1||!stops.length||routes.length!==1||!routes[0])fail('此車趟尚未整理成單一固定路線／一車，請聯絡調度');
  if(t.driver_id&&t.driver_id!==d.id)fail('此車趟已有不同的自有司機指派，請先由調度調整');
  const prior=await active(db,t.id);if(prior){if(prior.driver_id===d.id&&prior.reporter_hash===hash(userId))return '先前已接取，未重複建立。\n'+ack(t,prior);fail('此路線已被接取，請重新查詢可用任務');}
  if((await db.query('SELECT 1 FROM delivery_active_checkins WHERE trip_id=$1',[t.id])).rowCount)fail('此車趟已有報到紀錄，需由調度核對');
  if((await db.query("SELECT 1 FROM delivery_route_claims c JOIN delivery_trips t ON t.id=c.trip_id WHERE c.driver_id=$1 AND c.revoked_at IS NULL AND t.status NOT IN ('已完成','已取消') LIMIT 1",[d.id])).rowCount)fail('此司機已有未結束的接取車趟，請先完成或由調度撤回');
  const c=(await db.query('INSERT INTO delivery_route_claims(trip_id,driver_id,driver_code,driver_name,reporter_hash,route_code,service_date,fleet_id,fleet_name,departure_time,stop_count,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[t.id,d.id,d.publicCode,d.name,hash(userId),routes[0],t.service_date,fleet?.id||null,fleet?.name||'自有司機',t.departure_time,stops.length,eventId])).rows[0];
  await audit(db,{username:'LINE司機:'+d.publicCode,role:'driver'},'司機接取固定路線','蝦皮門店車趟',t.id,'路線 '+c.route_code+'；接取紀錄 '+c.id);
  await require('./fleetOperations').enqueueSheet(db,'routeCheckins',c.id);return ack(t,c);

}
async function handleGroup(...args){try{return await claimRoute(...args);}catch(e){if(e.claimStatus)return e.message;throw e;}}
async function resolvePrivate(db,key,userId){const d=await identity(db,userId),rows=(await db.query("SELECT t.*,w.name AS warehouse_name FROM delivery_route_claims c JOIN delivery_trips t ON t.id=c.trip_id JOIN delivery_warehouses w ON w.id=t.warehouse_id WHERE c.driver_id=$1 AND c.reporter_hash=$2 AND c.revoked_at IS NULL AND (upper(t.task_code)=$3 OR upper(c.route_code)=$3) LIMIT 2 FOR UPDATE OF t",[d.id,hash(userId),String(key).toUpperCase()])).rows;if(rows.length===1)return rows[0];if(rows.length>1)return null;return ownTrip(db,key,d.id);}
async function privateQuery(db,text,userId,eventId){
 if(/^(車趟報到|車趟狀態|報到)\s/.test(text)){try{return await require('./deliveryCheckins').handle(db,text,{id:null},userId,eventId);}catch(e){if(e.claimStatus)return e.message;throw e;}}
 if(/^(接取|接取路線)\s/.test(text))return handleGroup(db,text,null,userId,eventId);
 const returned=await require('./tripReturns').handle(db,text,null,userId,eventId);if(returned!==null)return returned;
 const m=String(text||'').normalize('NFKC').trim().match(/^我的路線(?:\s+([\p{Script=Han}A-Za-z0-9_-]{1,40}))?$/u);if(!m)return null;
 try{const d=await identity(db,userId),rows=(await db.query("SELECT t.*,c.id AS claim_id,c.route_code AS claimed_route,w.name AS warehouse_name FROM delivery_route_claims c JOIN delivery_trips t ON t.id=c.trip_id JOIN delivery_warehouses w ON w.id=t.warehouse_id WHERE c.driver_id=$1 AND c.reporter_hash=$2 AND c.revoked_at IS NULL AND t.status<>'已取消' AND ($3='' OR upper(t.task_code)=$3 OR upper(c.route_code)=$3) ORDER BY t.service_date DESC,c.id DESC LIMIT 21",[d.id,hash(userId),(m[1]||'').toUpperCase()])).rows;
 if(!rows.length)return '目前LINE帳號沒有已接取的路線。請先至已綁定車隊群組輸入「接取 路線編號 司機ID」。';
 if(rows.length!==1||!m[1])return '【我已接取的路線】\n'+rows.slice(0,20).map(t=>t.task_code+'｜'+t.claimed_route+'｜'+t.service_date+'｜'+t.status).join('\n')+'\n請輸入「我的路線 完整任務編號」查看自己的完整站點。';
 const t=rows[0],stops=(await db.query('SELECT * FROM delivery_trip_stops WHERE trip_id=$1 AND released_at IS NULL ORDER BY stop_no',[t.id])).rows,c=require('./deliveryCheckins');return c.format(t,stops,await c.counts(db,t.id),4200,{reveal:true});
 }catch(e){if(e.claimStatus)return e.message;throw e;}
}
module.exports={managed,hash,rosterRecord,createRosterCode,identity,active,verifyOwner,handleGroup,claimRoute,ownTrip,resolvePrivate,privateQuery};
