const {audit}=require('./transaction');
const dispatch=require('./deliveryDispatch');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{dispatchStatus:status});};
function validate(body){if(!body||!/^\d{1,15}$/.test(String(body.tripId))||typeof body.version!=='string'||body.version.length>40||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500||typeof body.fleetId!=='string'||body.fleetId.length>100)fail('請選擇任務、目標車隊及填寫改派原因',400);}
async function change(db,body,actor){
 validate(body);await db.query('SELECT pg_advisory_xact_lock(870032)');
 const t=(await db.query('SELECT * FROM delivery_trips WHERE id=$1 FOR UPDATE',[body.tripId])).rows[0];if(!t)fail('找不到車趟');
 if((t.fleet_id||'')===body.fleetId)fail('請選擇不同車隊，或退回待補車');
 const projected=(await require('./routeCarriers').attachTrips(db,[t]))[0];
 await dispatch.assign(db,{items:[{tripId:String(t.id),version:body.version,mode:body.fleetId?'fleet':'pending',...(body.fleetId?{fleetId:body.fleetId}:{})}],reason:body.reason.trim()},actor,(who,...args)=>audit(db,who,...args));
 const row=(await db.query('INSERT INTO delivery_fleet_changes(trip_id,previous_fleet_id,next_fleet_id,source_fleet_name,reason,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[t.id,t.fleet_id,body.fleetId||null,projected.source_fleet_name||t.source_fleet_name||'',body.reason.trim(),actor.username])).rows[0];
 await audit(db,actor,'變更執行車隊','蝦皮門店車趟',t.id,'改派歷程 '+row.id+'；'+body.reason.trim());
 return {updated:true,historyId:row.id,notificationSent:false};
}
module.exports={validate,change};
