const crypto=require('node:crypto');
const {audit}=require('./transaction');
const {todayInTaipei}=require('./dates');
const claims=require('./driverRouteClaims');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{claimStatus:status});};
const code=id=>'U'+String(id).padStart(6,'0');
async function trip(db,id){return (await db.query('SELECT t.*,w.name AS warehouse_name FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id WHERE t.id=$1 FOR UPDATE OF t',[id])).rows[0];}
async function original(db,key,fleet,userId){
 if(fleet)return require('./deliveryAliases').resolve(db,key,fleet.id,true);
 const rows=(await db.query("SELECT DISTINCT t.id FROM delivery_trips t LEFT JOIN delivery_route_claims c ON c.trip_id=t.id AND c.revoked_at IS NULL LEFT JOIN delivery_active_checkins r ON r.trip_id=t.id WHERE (c.reporter_hash=$1 OR r.reporter_hash=$1) AND t.service_date=$3 AND (upper(t.task_code)=$2 OR upper(c.route_code)=$2 OR EXISTS(SELECT 1 FROM delivery_trip_stops s WHERE s.trip_id=t.id AND upper(s.route_code)=$2)) LIMIT 2",[claims.hash(userId),key.toUpperCase(),todayInTaipei()])).rows;return rows.length===1?trip(db,rows[0].id):null;
}
async function ownership(db,t,userId,admin=false,record){
 const c=await claims.active(db,t.id),reporterHash=admin?record.reporter_hash:claims.hash(userId);
 const check=(await db.query('SELECT * FROM delivery_active_checkins WHERE trip_id=$1 AND reporter_hash=$2 FOR UPDATE',[t.id,reporterHash])).rows[0];
 if(admin){if(c&&c.reporter_hash!==reporterHash||record.claim_id&&String(c?.id)!==String(record.claim_id)||record.checkin_id&&String(check?.id)!==String(record.checkin_id))fail('接取或報到已變更，不能處理舊退趟申請');}
 else if(claims.managed(t)){await claims.verifyOwner(db,t,userId);}
 else if(c&&c.reporter_hash!==reporterHash||!c&&!check)fail('目前LINE帳號沒有此車趟的有效接取或報到');
 if(!c&&!check)fail('此車趟已沒有可撤回的有效接取或報到');
 return {claim:c,checkin:check,hash:reporterHash,driverId:c?.driver_id||check?.driver_id||null,driverCode:c?.driver_code||'',routeCode:c?.route_code||t.task_code};
}
async function queue(db,t,r,claimId){if(t.is_simulated)return;const {enqueueSheet}=require('./fleetOperations');if(claimId)await enqueueSheet(db,'routeCheckins',claimId);await enqueueSheet(db,'tripReturns',r.id);}
async function apply(db,t,o,r,actor,approved=false){
 if(['已完成','已取消'].includes(t.status))fail('已結束車趟只能保留歷史註記，不能自動重開或移轉報到');
 if(o.checkin)await db.query('UPDATE delivery_checkins SET voided_at=clock_timestamp(),voided_by=$2,void_reason=$3 WHERE id=$1 AND voided_at IS NULL',[o.checkin.id,actor.username,r.reason]);
 if(o.claim)await db.query('UPDATE delivery_route_claims SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3,updated_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL',[o.claim.id,actor.username,r.reason]);
 if(t.driver_id&&t.driver_id===o.driverId&&['待派車','已派車'].includes(t.status)){
  const version=(await db.query("SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS v FROM delivery_trips WHERE id=$1",[t.id])).rows[0].v;
  await require('./deliveryDispatch').assign(db,{items:[{tripId:String(t.id),version,mode:'pending'}],reason:'退趟 '+r.reason},actor,(who,...args)=>audit(db,who,...args));
 }
 await db.query("UPDATE delivery_trip_returns SET status='已處理',processed_at=clock_timestamp(),reviewed_by=$2 WHERE id=$1",[r.id,actor.username]);
 await audit(db,actor,r.kind,'蝦皮門店車趟',t.id,'退趟紀錄 '+code(r.id)+'；原報到ID '+(o.checkin?.id||'無')+'；原因 '+r.reason+(approved?'；主管覆核':''));await queue(db,t,r,o.claim?.id);
}
async function request(db,{trip:t,userId,reason,target,kind='退趟',eventId,actor,admin=false,prior,verifiedRecord}){
 if(!t)fail('找不到目前可操作的車趟');if(typeof reason!=='string'||!reason.trim()||reason.trim().length>500)fail('請填寫1～500字的退趟或改報原因',400);reason=reason.trim();
 if(!admin&&t.service_date!==todayInTaipei())fail('只可線上退回或改報今日車趟；歷史紀錄請由管理員另行註記');if(['已完成','已取消'].includes(t.status))fail('已結束車趟不能退趟或改報');
 const o=await ownership(db,t,userId,admin,prior||verifiedRecord);if(kind==='改報'&&!o.checkin)fail('原車趟尚未報到，請先退回接取，再接取正確路線');
 const old=(await db.query("SELECT * FROM delivery_trip_returns WHERE trip_id=$1 AND reporter_hash=$2 AND status='待覆核' FOR UPDATE",[t.id,o.hash])).rows[0];if(old&&!admin)return {record:old,trip:t,ownership:o,pending:true};
 const pending=!['待派車','已派車'].includes(t.status)&&!admin;
 const r=prior||(await db.query('INSERT INTO delivery_trip_returns(trip_id,claim_id,checkin_id,target_trip_id,reporter_hash,driver_id,driver_code,route_code,fleet_id,kind,status,reason,actor,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[t.id,o.claim?.id||null,o.checkin?.id||null,target?.id||null,o.hash,o.driverId,o.driverCode,o.routeCode,t.fleet_id,kind,pending?'待覆核':'已處理',reason,actor.username,eventId])).rows[0];
 if(pending){await audit(db,actor,'申請'+kind,'蝦皮門店車趟',t.id,code(r.id)+'；已出發，原報到與數量保留，等待主管覆核');await queue(db,t,r,o.claim?.id);return {record:r,trip:t,ownership:o,pending:true};}
 await apply(db,t,o,r,actor,admin);return {record:r,trip:t,ownership:o,pending:false};
}
async function perform(db,text,fleet,userId,eventId,actorOverride){
 text=String(text||'').normalize('NFKC').trim();const back=text.match(/^(?:退趟|退車趟)\s+([\p{Script=Han}A-Za-z0-9_-]{1,40})\s+([\s\S]{1,500})$/u),change=text.match(/^改報\s+([\p{Script=Han}A-Za-z0-9_-]{1,40})\s+([\p{Script=Han}A-Za-z0-9_-]{1,40})\s+([^\s]{1,100})\s+([\s\S]{1,500})$/u);
 if(!back&&!change)return /^(退趟|退車趟|改報)(?:\s|$)/.test(text)?'退趟：退趟 原路線編號 原因\n改報：改報 原路線編號 正確路線編號 司機ID 原因':null;
 await db.query('SELECT pg_advisory_xact_lock(870033)');const t=await original(db,(back||change)[1],fleet,userId),actor=actorOverride||{username:'LINE司機:'+claims.hash(userId).slice(0,12),role:'driver'};
 if(back){const r=await request(db,{trip:t,userId,reason:back[2],eventId,actor});if(r.pending)return code(r.record.id)+' 退趟申請待主管覆核；原報到與數量尚未取消。';return code(r.record.id)+' 退趟完成，原紀錄已保留。\n有效報到 '+await require('./deliveryCheckins').counts(db,t.id)+'／需求 '+t.required_checkins+'，可重新安排車趟。';}
 const d=await claims.identity(db,userId,change[3]);if(!t)fail('找不到原車趟');const context=fleet||(t.fleet_id?(await db.query('SELECT id,name,status FROM partner_fleets WHERE id=$1',[t.fleet_id])).rows[0]:null),target=context?await require('./deliveryAliases').resolve(db,change[2],context.id,true):await claims.ownTrip(db,change[2],d.id);
 if(!target||String(target.id)===String(t.id))fail('請選擇同車隊、不同於原車趟的今日有效目標路線');
 if(target.is_simulated||!claims.managed(target))fail('改報目標必須是正式固定路線，不能改報到模擬資料');
 const result=await request(db,{trip:t,userId,reason:change[4],target,kind:'改報',eventId,actor});if(result.pending)return code(result.record.id)+' 改報申請待主管覆核；原報到與目標路線均未變更。';
 await claims.claimRoute(db,'接取 '+target.task_code+' '+d.publicCode,context,userId,eventId+':claim');
 await require('./deliveryCheckins').handle(db,'車趟報到 '+target.task_code,context||{id:null},userId,eventId+':checkin');
 if(!(await db.query('SELECT 1 FROM delivery_active_checkins WHERE trip_id=$1 AND reporter_hash=$2',[target.id,claims.hash(userId)])).rowCount)fail('目標路線無法完成報到，本次改報全部撤回');
 return code(result.record.id)+' 改報成功：'+t.task_code+' → '+target.task_code+'。原報到留存為已撤回，正確車趟已完成接取與報到。';
}
async function handle(db,text,fleet,userId,eventId,actor){
 if(!/^(退趟|退車趟|改報)(?:\s|$)/.test(String(text||'').normalize('NFKC').trim()))return null;
 await db.query('SAVEPOINT wayan_trip_return');try{const result=await perform(db,text,fleet,userId,eventId,actor);await db.query('RELEASE SAVEPOINT wayan_trip_return');return result;}catch(e){await db.query('ROLLBACK TO SAVEPOINT wayan_trip_return');await db.query('RELEASE SAVEPOINT wayan_trip_return');if(e.claimStatus)return e.message;throw e;}
}
async function review(db,id,body,actor){
 if(body?.decision==='approve'&&body.verified!==true)fail('請先核對現場狀況',400);
 if(!['approve','reject'].includes(body?.decision)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500)fail('需選擇核准／拒絕及覆核原因',400);await db.query('SELECT pg_advisory_xact_lock(870033)');
 const r=(await db.query('SELECT * FROM delivery_trip_returns WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!r||r.status!=='待覆核')fail('此申請不存在或已覆核');const t=await trip(db,r.trip_id);
 if(body.decision==='reject'){await db.query("UPDATE delivery_trip_returns SET status='已拒絕',processed_at=clock_timestamp(),reviewed_by=$2,review_note=$3 WHERE id=$1",[id,actor.username,body.reason.trim()]);await audit(db,actor,'拒絕退趟／改報','蝦皮門店車趟',t.id,code(id)+'；'+body.reason.trim());await queue(db,t,r,r.claim_id);return {status:'已拒絕'};}
 const o=await ownership(db,t,null,true,r);
 await apply(db,t,o,r,actor,true);if(r.kind==='改報'){const b=(await db.query('SELECT line_user_id FROM line_driver_bindings WHERE driver_id=$1',[r.driver_id])).rows[0];if(!b||claims.hash(b.line_user_id)!==r.reporter_hash)fail('司機LINE綁定已變更，請先核對身分，原報到不會異動');const target=await trip(db,r.target_trip_id);if(!target||target.fleet_id!==t.fleet_id)fail('目標路線已變更或車隊不符');await finishCorrection(db,target,b.line_user_id,'return-review:'+r.id,actor);}
 await db.query('UPDATE delivery_trip_returns SET review_note=$2 WHERE id=$1',[id,body.reason.trim()]);return {status:'已處理',notice:t.status==='配送中'?'原車趟仍為配送中，狀態及實際作業請由調度另行確認':'有效報到已撤回'};
}
async function finishCorrection(db,target,userId,eventId,actor){const d=await claims.identity(db,userId),context=target.fleet_id?(await db.query('SELECT id,name,status FROM partner_fleets WHERE id=$1',[target.fleet_id])).rows[0]:null;await claims.claimRoute(db,'接取 '+target.task_code+' '+d.publicCode,context,userId,eventId+':claim');await require('./deliveryCheckins').handle(db,'車趟報到 '+target.task_code,context||{id:null},userId,eventId+':checkin');if(!(await db.query('SELECT 1 FROM delivery_active_checkins WHERE trip_id=$1 AND reporter_hash=$2',[target.id,claims.hash(userId)])).rowCount)fail('目標路線無法完成報到，本次改報全部撤回');await audit(db,actor,'改報目標接取與報到','蝦皮門店車趟',target.id,'退趟流程原子處理');}
module.exports={handle,perform,request,review,trip,ownership,finishCorrection,code};
