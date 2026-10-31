const {audit}=require('./transaction');
async function observeGroup(db,event){
  const id=event.source?.groupId;if(event.source?.type!=='group'||typeof id!=='string'||!['message','join','leave'].includes(event.type))return;
  await db.query('SELECT pg_advisory_xact_lock(870033)');
  await db.query(`INSERT INTO line_group_registry(group_id,bot_present,last_seen_at,last_event_type,created_by) VALUES($1,$2,NOW(),$3,'LINE簽章事件') ON CONFLICT(group_id) DO UPDATE SET bot_present=EXCLUDED.bot_present,last_seen_at=NOW(),last_event_type=EXCLUDED.last_event_type`,[id,event.type!=='leave',event.type]);
  if(event.type==='leave'){
    const old=(await db.query('DELETE FROM line_fleet_groups WHERE group_id=$1 RETURNING fleet_id',[id])).rows[0];
    if(old){await audit(db,{username:'LINE系統',role:'system'},'Bot離開群組','夥伴車隊',old.fleet_id,'解除存取綁定');await require('./fleetOperations').enqueueSheet(db,'fleets',old.fleet_id);}
  }
}
async function bindSelectedGroup(db,groupId,fleetId,actor){
  if(actor.role!=='admin')return '選擇群組綁定僅限管理員';
  const g=(await db.query('SELECT * FROM line_group_registry WHERE group_id=$1 FOR UPDATE',[groupId])).rows[0];
  if(!g?.bot_present||!g.last_seen_at)return '此群組尚未收到有效 LINE 事件或 Bot 已離開，請先邀請 Bot 並在群組傳送訊息';
  const f=(await db.query("SELECT 1 FROM partner_fleets WHERE id=$1 AND status='啟用'",[fleetId])).rowCount;if(!f)return '請選擇啟用中的車隊';
  const used=(await db.query('SELECT * FROM line_fleet_groups WHERE group_id=$1 OR fleet_id=$2',[groupId,fleetId])).rows;
  if(used.some(r=>r.group_id===groupId&&r.fleet_id===fleetId))return null;
  if(used.length)return '群組或車隊已有其他綁定，請先解除原綁定';
  await db.query('INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES($1,$2,$3)',[groupId,fleetId,actor.username]);
  await db.query('DELETE FROM fleet_group_codes WHERE fleet_id=$1',[fleetId]);
  await audit(db,actor,'選擇已驗證群組','夥伴車隊',fleetId,g.label||groupId);await require('./fleetOperations').enqueueSheet(db,'fleets',fleetId);return null;
}
module.exports={observeGroup,bindSelectedGroup};
