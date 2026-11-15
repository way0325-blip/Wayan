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
 if(!c&&!/^(說明|help|指令|接單|退單|查任務|回報|任務|車隊任務|門店車趟|異常回報|接取|接取路線|車趟報到|報到|車趟狀態|退趟|退車趟|改報|車趟異常)(?:\s|$)/i.test(String(event.message.text||'').trim()))return null;
 if(!c)return require('./botCommands').groupHelp;
 if(!event.source.userId)return '無法確認回報者，請聯絡調度。';
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 let rows=(await db.query("SELECT t.id,t.task_code,t.fleet_id,f.name,f.status FROM delivery_trips t JOIN partner_fleets f ON f.id=t.fleet_id JOIN line_shared_group_fleets g ON g.fleet_id=f.id AND g.group_id=$1 WHERE upper(t.task_code)=$2 AND t.service_date=$3 AND NOT t.is_simulated AND t.driver_claim_required=TRUE LIMIT 2 FOR SHARE OF t,f",[group,c.key,todayInTaipei()])).rows;
 if(!rows.length){rows=(await db.query("SELECT t.id,t.task_code,t.fleet_id,f.name,f.status FROM delivery_trips t JOIN partner_fleets f ON f.id=t.fleet_id JOIN line_shared_group_fleets g ON g.fleet_id=f.id AND g.group_id=$1 WHERE t.service_date=$3 AND NOT t.is_simulated AND t.driver_claim_required=TRUE AND t.status NOT IN ('已完成','已取消') AND EXISTS(SELECT 1 FROM delivery_trip_stops s WHERE s.trip_id=t.id AND s.released_at IS NULL AND upper(trim(s.route_code))=$2) ORDER BY f.name,t.task_code LIMIT 6 FOR SHARE OF t,f",[group,c.key,todayInTaipei()])).rows;}
 if(rows.length>1)return '找到多個同路線任務，請使用完整任務編號：\n'+rows.slice(0,5).map(t=>t.name+'｜'+t.task_code).join('\n');
 if(rows.length!==1)return '找不到本群組可操作的今日唯一任務，請確認任務編號與車隊。';
 const t=rows[0];c.text=c.text.replace(/^(\S+\s+)\S+/,(_,prefix)=>prefix+t.task_code);const permission=allowed.find(a=>a.fleet_id===t.fleet_id);
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
async function bindCode(db,event){const m=String(event.message?.text||'').trim().match(/^作業群組設定\s+([A-Za-z0-9_-]{22})$/);if(!m)return /^作業群組設定(?:\s|$)/.test(String(event.message?.text||''))?'請完整複製平台產生的「作業群組設定 代碼」，不可省略或修改。':null;if(event.source?.type!=='group')return '請將此設定指令貼到正確的橘箱／黑箱大群組。';await db.query('SELECT pg_advisory_xact_lock(870033)');const group=event.source.groupId;if((await db.query('SELECT 1 FROM line_fleet_groups WHERE group_id=$1',[group])).rowCount)return '這是已綁定的車隊通知群，不能直接改為共同作業群。請將設定指令貼到指定橘箱／黑箱大群組。';const hash=require('node:crypto').createHash('sha256').update(m[1]).digest('hex'),r=(await db.query('SELECT * FROM line_shared_group_codes WHERE code_hash=$1 AND expires_at>NOW() FOR UPDATE',[hash])).rows[0];if(!r)return '設定碼無效或已過期，請在平台重新產生。';if(!(await db.query("SELECT 1 FROM users WHERE username=$1 AND role='admin'",[r.created_by])).rowCount)return '設定碼建立者權限已變更，請重新申請。';const count=(await db.query("SELECT 1 FROM partner_fleets WHERE id=ANY($1::text[]) AND status='啟用' AND NOT is_simulated",[r.fleet_ids])).rowCount;if(count!==r.fleet_ids.length)return '可操作車隊名冊已變更，請管理員重新產生設定碼。';await db.query('DELETE FROM line_shared_group_fleets WHERE group_id=$1',[group]);for(const id of r.fleet_ids)await db.query('INSERT INTO line_shared_group_fleets(group_id,fleet_id,business_scope,created_by) VALUES($1,$2,$3,$4)',[group,id,r.business_scope,r.created_by]);await db.query('UPDATE line_group_registry SET label=$2 WHERE group_id=$1',[group,r.group_label]);await db.query('DELETE FROM line_shared_group_codes WHERE business_scope=$1',[r.business_scope]);await require('./transaction').audit(db,{username:r.created_by,role:'admin'},'以一次性代碼設定共同作業群組','LINE',group,r.group_label+'；'+r.business_scope+'；允許'+r.fleet_ids.length+'家車隊');return '共同作業群組設定完成：'+r.group_label+'。\n允許 '+r.fleet_ids.length+' 家車隊；請輸入「說明」查看接單、報到及退單指令。';}
module.exports={command,business,handle,bindCode};
