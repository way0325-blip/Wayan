const {todayInTaipei}=require('./dates');
function command(text){
 const s=String(text||'').normalize('NFKC').trim();
 const m=s.match(/^(接取|接取路線|車趟報到|報到|車趟狀態|退趟|退車趟|改報|車趟異常)\s+([A-Za-z0-9_-]{1,40})(?:\s|$)/u);
 return m?{text:s,key:m[2].toUpperCase()}:null;
}
async function handle(db,event,eventId){
 if(event.source?.type!=='group'||event.message?.type!=='text')return null;
 const group=event.source.groupId,allowed=(await db.query('SELECT fleet_id,business_scope FROM line_shared_group_fleets WHERE group_id=$1',[group])).rows;
 if(!allowed.length)return null;
 const c=command(event.message.text);
 if(!c&&!/^(說明|help|指令|接取|接取路線|車趟報到|報到|車趟狀態|退趟|退車趟|改報|車趟異常)(?:\s|$)/i.test(String(event.message.text||'').trim()))return null;
 if(!c)return require('./botCommands').groupHelp;
 if(!event.source.userId)return '無法確認回報者，請聯絡調度。';
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 const rows=(await db.query("SELECT t.id,t.task_code,t.fleet_id,f.name,f.status FROM delivery_trips t JOIN partner_fleets f ON f.id=t.fleet_id JOIN line_shared_group_fleets g ON g.fleet_id=f.id AND g.group_id=$1 WHERE upper(t.task_code)=$2 AND t.service_date=$3 AND NOT t.is_simulated AND t.driver_claim_required=TRUE LIMIT 2 FOR SHARE OF t,f",[group,c.key,todayInTaipei()])).rows;
 if(rows.length!==1)return '找不到本群組可操作的今日唯一任務，請使用完整任務編號並確認車隊已加入共同作業群組。';
 const t=rows[0],permission=allowed.find(a=>a.fleet_id===t.fleet_id);
 const scope=permission?.business_scope||'all';
 const targets=[t.id];
 if(/^改報\s/.test(c.text)){
  const targetKey=c.text.split(/\s+/)[2];
  const target=(await db.query("SELECT id FROM delivery_trips WHERE upper(task_code)=$1 AND fleet_id=$2 AND service_date=$3 AND NOT is_simulated AND driver_claim_required=TRUE LIMIT 2",[String(targetKey||'').toUpperCase(),t.fleet_id,todayInTaipei()])).rows;
  if(target.length!==1)return '改報須使用同一執行車隊的完整目標任務編號。';targets.push(target[0].id);
 }
 if(scope!=='all'){
  const routes=(await db.query('SELECT DISTINCT route_code FROM delivery_trip_stops WHERE trip_id=ANY($1::bigint[]) AND released_at IS NULL',[targets])).rows;
  if(!routes.length||routes.some(r=>business(r.route_code)!==scope))return '任務類型不符合此群組，請至對應的橘箱／黑箱作業群組操作；未異動任何紀錄。';
 }
 const fleet={id:t.fleet_id,name:t.name,status:t.status};
 if(fleet.status!=='啟用')return '任務原屬車隊已停用，請聯絡調度。';
 const activity=await require('./lineActivity').recordActivity(db,event,eventId,fleet.id);if(activity?.skip)return null;
 let reply=await require('./tripReturns').handle(db,c.text,fleet,event.source.userId,eventId);
 if(reply===null)reply=await require('./driverRouteClaims').handleGroup(db,c.text,fleet,event.source.userId,eventId);
 if(reply===null)reply=await require('./deliveryCheckins').handle(db,c.text,fleet,event.source.userId,eventId);
 return '【'+fleet.name+'｜'+t.task_code+'】\n'+(reply||'指令格式不完整，請輸入「說明」查看格式。');
}
function business(code){const prefix=String(code||'').trim().toUpperCase().split('-')[0];if(['NB','NJ','NC','FM','FN','FC'].includes(prefix))return 'orange';if(['WB','WD','WC'].includes(prefix))return 'black';return 'pending';}
module.exports={command,business,handle};
