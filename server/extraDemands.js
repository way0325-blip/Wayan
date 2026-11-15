const {audit}=require('./transaction');
const {todayInTaipei}=require('./dates');
async function capture(db,event,eventId){
 if(event.source?.type!=='group'||event.message?.type!=='text')return null;
 if(!(await db.query('SELECT 1 FROM line_demand_sources WHERE group_id=$1 AND enabled',[event.source.groupId])).rowCount)return null;
 const parsed=require('./extraDemandModel').parse(event.message.text,Number(todayInTaipei().slice(0,4)));
 if(!parsed.rows.length)return null;if(parsed.rows.length>30||parsed.issues.length)return '追加需求日期、時段或車數需要核對，尚未建立；請由調度在平台確認。';
 for(const [index,r] of parsed.rows.entries())await db.query('INSERT INTO extra_transport_demands(source_event_id,source_group_id,source_index,service_date,departure_time,task_name,business_scope,required_trucks,driver_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_event_id,source_index) DO NOTHING',[eventId,event.source.groupId,index,r.date,r.time,r.name,r.business,r.count,parsed.deadline||null]);
 await audit(db,{username:'LINE需求擷取',role:'system'},'擷取追加需求草稿','追加需求',eventId,parsed.rows.length+'筆；未派車');
 return '已擷取追加需求 '+parsed.rows.length+' 筆／共 '+parsed.rows.reduce((n,r)=>n+r.count,0)+' 車，待調度確認車隊與路線；尚未派車。';
}
async function handle(db,event,eventId){
 const text=String(event.message?.text||''),m=text.match(/^(接取|車趟報到|車趟狀態|退趟|完成|車趟異常)\s+E0*([1-9]\d{0,14})(?:\s+([\s\S]+))?$/);if(!m)return null;
 if(event.source?.type!=='group'||!event.source.userId)return '追加需求請在指定作業群組操作。';
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 const r=(await db.query("SELECT s.*,d.service_date,d.departure_time,d.task_name,d.business_scope,d.status,f.name AS fleet_name FROM extra_transport_slots s JOIN extra_transport_demands d ON d.id=s.demand_id JOIN partner_fleets f ON f.id=s.fleet_id JOIN line_shared_group_fleets g ON g.fleet_id=s.fleet_id AND g.group_id=$1 WHERE s.id=$2 AND d.status='已確認' AND f.status='啟用' AND (g.business_scope='all' OR g.business_scope=d.business_scope) FOR UPDATE OF s",[event.source.groupId,m[2]])).rows[0];
 if(!r)return '找不到本群組可操作的追加任務，請確認已指定車隊及完成調度確認。';
 if(r.completed_at&&m[1]!=='車趟狀態')return '追加任務已完成，不能重新接取、報到或退單。';
 if(r.service_date<todayInTaipei())return '歷史追加任務請由調度另行核對，不能新增接單或報到。';
 if(['車趟報到','完成'].includes(m[1])&&r.service_date!==todayInTaipei())return '只能在作業當日報到或完成；可先提前接單提供司機ID。';
 try{
 const driver=await require('./driverRouteClaims').identity(db,event.source.userId,m[1]==='接取'?m[3]:undefined);
 const activity=await require('./lineActivity').recordActivity(db,event,eventId,r.fleet_id);if(activity?.skip)return null;
 const heading='【'+r.fleet_name+'｜E'+r.id+'】\n'+r.service_date+' '+r.departure_time+' '+r.task_name+'\n'+(r.route_code?'路線：'+r.route_code:'路線待提供，請等待調度通知');
 if(m[1]==='車趟狀態')return heading+'\n'+(r.completed_at?'已完成':r.checked_in_at?'已報到':r.accepted_at?'已接單':'待接單');
 if(r.driver_id&&r.driver_id!==driver.id)return '此追加車位已由其他司機接取，不能代為操作。';
 if(m[1]==='車趟異常'){
 if(!r.driver_id)return '請先接單，再回報本人的追加任務異常。';
 const detail=String(m[3]||'').match(/^(延誤|車輛異常|貨損|事故|其他)\s+([\s\S]{1,1000})$/);if(!detail||!detail[2].trim())return '回報 E任務編號 延誤／車輛異常／貨損／事故／其他 說明';
 const incident=await require('./fleetOperations').addIncident(db,{general:true,fleet_id:r.fleet_id},detail[1],'追加任務 E'+r.id+'｜'+r.service_date+' '+r.departure_time+'｜'+detail[2].trim(),{username:'LINE司機:'+driver.publicCode,role:'driver'},eventId);
 return heading+'\n異常 '+require('./fleetOperations').caseNumber(incident.id)+' 已登記，Google Sheets 已排入同步。';
 }
 if(m[1]==='接取'){
 if(!m[3]||/\s/.test(m[3]))return '接單 E任務編號 司機ID';
 if(r.driver_id)return heading+'\n先前已接單，未重複建立。';
 if((await db.query("SELECT 1 FROM extra_transport_slots s JOIN extra_transport_demands d ON d.id=s.demand_id WHERE s.driver_id=$1 AND s.completed_at IS NULL AND d.service_date=$2 AND s.id<>$3 UNION ALL SELECT 1 FROM delivery_route_claims c JOIN delivery_trips t ON t.id=c.trip_id WHERE c.driver_id=$1 AND c.revoked_at IS NULL AND t.status NOT IN ('已完成','已取消') LIMIT 1",[driver.id,r.service_date,r.id])).rowCount)return '此司機已有尚未結束的任務，請先完成或退單。';
 await db.query('UPDATE extra_transport_slots SET driver_id=$2,driver_code=$3,accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',[r.id,driver.id,driver.publicCode]);
 }else if(m[1]==='車趟報到'){
 if(!r.driver_id)return '請先輸入「接單 E'+r.id+' 司機ID」。';
 if(r.checked_in_at)return heading+'\n先前已報到，未重複計數。';
 await db.query('UPDATE extra_transport_slots SET checked_in_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',[r.id]);
 }else if(m[1]==='完成'){
 if(!r.driver_id||!r.checked_in_at)return '請先完成本人接單與報到。';
 await db.query('UPDATE extra_transport_slots SET completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',[r.id]);
 }else{
 if(!r.driver_id)return '此車位尚未接取，不需要退單。';if(!m[3]?.trim()||m[3].length>500)return '請填寫退單原因（1～500字）。';
 if(r.checked_in_at)return '此追加車位已報到，請聯絡調度覆核交接；尚未取消報到。';
 await db.query("UPDATE extra_transport_slots SET driver_id=NULL,driver_code='',accepted_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[r.id]);
 }
 await db.query('INSERT INTO extra_transport_history(slot_id,demand_id,action,actor,detail) VALUES($1,$2,$3,$4,$5)',[r.id,r.demand_id,m[1],driver.publicCode,JSON.stringify({eventId,beforeDriver:r.driver_code,beforeAccepted:r.accepted_at,beforeCheckin:r.checked_in_at,reason:m[1]==='退趟'?m[3]:''})]);
 await audit(db,{username:'LINE司機:'+driver.publicCode,role:'driver'},'追加需求'+m[1],'追加任務',r.id,'原屬執行車隊 '+r.fleet_id);
 return heading+'\n'+(m[1]==='接取'?'接單成功。':m[1]==='車趟報到'?'報到成功。':m[1]==='完成'?'任務已完成。':'退單完成，歷程已保留。');
 }catch(e){if(e.claimStatus)return e.message;throw e;}
}
module.exports={capture,handle};
