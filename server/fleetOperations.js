const crypto=require('node:crypto');
const {audit}=require('./transaction');
const codeHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const taskNumber=id=>'T'+String(id).padStart(6,'0');
const caseNumber=id=>'I'+String(id).padStart(6,'0');
const parseTask=value=>String(value||'').match(/^(?:T)?0*([1-9]\d{0,14})$/i)?.[1]||null;

async function enqueueSheet(db,key,id){
  await db.query(`INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload) VALUES($1,$2,'sheet',$3)
    ON CONFLICT(job_key) DO UPDATE SET revision=fleet_delivery_jobs.revision+1,
    status=CASE WHEN fleet_delivery_jobs.status='processing' THEN 'processing' ELSE 'pending' END,
    attempts=CASE WHEN fleet_delivery_jobs.status='processing' THEN fleet_delivery_jobs.attempts ELSE 0 END,
    error_code=NULL,next_attempt_at=NOW(),updated_at=NOW()`,[crypto.randomUUID(),`sheet:${key}:${id}`,{key,id:String(id)}]);
}
async function usedCapacity(db,fleetId,day,excludeId=null){
  return (await db.query(`SELECT
    COALESCE((SELECT SUM(CASE WHEN status='待回覆' THEN requested_trucks ELSE confirmed_trucks END)
      FROM fleet_work_orders WHERE fleet_id=$1 AND service_date=$2 AND status NOT IN ('已拒絕','已取消') AND ($3::bigint IS NULL OR id<>$3)),0)
    +COALESCE((SELECT SUM(CASE WHEN a.status='已確認' THEN a.confirmed_trucks ELSE a.requested_trucks END)
      FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id WHERE a.fleet_id=$1 AND r.service_date=$2 AND a.status<>'已拒絕'),0) AS n`,[fleetId,day,excludeId])).rows[0].n;
}
async function queueNotification(db,task,actor){
  const group=(await db.query('SELECT group_id FROM line_fleet_groups WHERE fleet_id=$1',[task.fleet_id])).rows[0];
  if(!group) return {error:'此車隊尚未綁定 LINE 群組',status:409};
  if(['已取消','已拒絕','已完成'].includes(task.status)) return {error:'此任務已結束，無法發送新任務通知',status:409};
  const version=task.updated_at.toISOString();
  const result=await db.query(`INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload)
    VALUES($1,$2,'line',$3) ON CONFLICT(job_key) DO NOTHING RETURNING id`,
    [crypto.randomUUID(),`line:task:${task.id}:${version}:${group.group_id}`,{taskId:String(task.id),groupId:group.group_id,version}]);
  if(result.rowCount) await audit(db,actor,'排入LINE通知','車隊任務',task.id,task.title);
  return {queued:result.rowCount===1,duplicate:result.rowCount===0};
}
async function addIncident(db,task,kind,description,actor,eventId=null){
  const incident=(await db.query(`INSERT INTO fleet_incidents(task_id,fleet_id,line_event_id,kind,severity,description,reported_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[task.id,task.fleet_id,eventId,kind,kind==='事故'?'緊急':'一般',description,actor.username])).rows[0];
  const history=(await db.query(`INSERT INTO fleet_incident_history(incident_id,actor,action,next_status,note)
    VALUES($1,$2,'建立回報','待處理',$3) RETURNING id`,[incident.id,actor.username,description])).rows[0];
  await audit(db,actor,'建立異常','車隊異常',incident.id,`${kind} ${taskNumber(task.id)}`);
  await enqueueSheet(db,'incidents',incident.id);await enqueueSheet(db,'history',history.id);
  return incident;
}
async function handleFleetGroupEvent(db,event,eventId){
  if(event.source?.type!=='group' || event.message?.type!=='text') return null;
  const text=String(event.message.text||'').trim(),groupId=event.source.groupId,userId=event.source.userId;
  if(typeof groupId!=='string' || typeof userId!=='string') return '無法確認回報者，請聯絡調度人員使用平台登記。';
  const bind=text.match(/^車隊群組綁定\s+([A-Za-z0-9_-]{22})$/);
  if(bind){
    await db.query('SELECT pg_advisory_xact_lock(870033)');
    const code=(await db.query(`SELECT c.*,f.status FROM fleet_group_codes c JOIN partner_fleets f ON f.id=c.fleet_id
      WHERE code_hash=$1 AND expires_at>NOW() FOR UPDATE OF c`,[codeHash(bind[1])])).rows[0];
    if(!code || code.status!=='啟用') return '車隊綁定碼無效、已過期或車隊已停用。';
    const used=await db.query('SELECT 1 FROM line_fleet_groups WHERE group_id=$1 OR fleet_id=$2',[groupId,code.fleet_id]);
    if(used.rowCount) return '群組或車隊已綁定，請由管理員先解除原有綁定。';
    await db.query('INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES($1,$2,$3)',[groupId,code.fleet_id,userId]);
    await db.query('DELETE FROM fleet_group_codes WHERE fleet_id=$1',[code.fleet_id]);
    await audit(db,{username:'LINE車隊管理者',role:'fleet'},'綁定群組','夥伴車隊',code.fleet_id,'一次性代碼驗證');
    await enqueueSheet(db,'fleets',code.fleet_id);
    return '車隊群組綁定完成。輸入「車隊任務」查看本車隊的任務。群組成員均可回報，請管理員確認群組成員名單。';
  }
  await db.query('SELECT pg_advisory_xact_lock(870033)');
  const fleet=(await db.query(`SELECT f.id,f.name,f.status FROM line_fleet_groups g JOIN partner_fleets f ON f.id=g.fleet_id WHERE g.group_id=$1 FOR SHARE OF g,f`,[groupId])).rows[0];
  if(!fleet) return null;
  if(fleet.status!=='啟用') return '車隊已停用，請聯絡管理員。';
  const actor={username:`LINE車隊:${fleet.id}:${userId.slice(-6)}`,role:'fleet'};
  if(/^(車隊任務|任務)$/.test(text)){
    const tasks=(await db.query(`SELECT * FROM fleet_work_orders WHERE fleet_id=$1 AND status NOT IN ('已完成','已取消','已拒絕') ORDER BY service_date,id LIMIT 20`,[fleet.id])).rows;
    return `【${fleet.name} 任務】\n`+(tasks.map(t=>`${taskNumber(t.id)} ${t.service_date} ${t.origin}→${t.destination} ${t.requested_trucks}車 ${t.status}`).join('\n')||'目前沒有待處理任務。');
  }
  const command=text.match(/^(承接|拒絕|到站|完成|異常|延誤|貨損|事故|車輛異常)\s+(\S+)(?:\s+([\s\S]+))?$/);
  if(!command) return '【車隊指令】\n車隊任務\n承接 T任務編號 車數\n拒絕 T任務編號 原因\n到站 T任務編號\n完成 T任務編號\n異常／延誤／貨損／事故／車輛異常 T任務編號 說明';
  const [,kind,identifier,detail]=command,id=parseTask(identifier);
  if(!id) return '任務編號格式錯誤，請使用通知中的 T任務編號。';
  await db.query('SELECT pg_advisory_xact_lock(870033)');
  const task=(await db.query('SELECT * FROM fleet_work_orders WHERE id=$1 AND fleet_id=$2 FOR UPDATE',[id,fleet.id])).rows[0];
  if(!task) return '找不到本車隊可操作的任務。';
  if(['異常','延誤','貨損','事故','車輛異常'].includes(kind)){
    if(task.status==='已取消') return '已取消任務不能新增回報。';
    if(!detail?.trim() || detail.trim().length>1000) return '請提供 1～1000 字的異常說明。';
    const incident=await addIncident(db,task,kind==='異常'?'其他':kind,detail.trim(),actor,eventId);
    return `異常已登記，案件編號 ${caseNumber(incident.id)}。管理端已收到通知，雲端表單已排入同步。`;
  }
  let next,confirmed=task.confirmed_trucks;
  if(kind==='承接'){
    if(task.status!=='待回覆') return '此任務已回覆，請聯絡調度人員修改。';
    if(!/^\d+$/.test(detail||'') || Number(detail)<1 || Number(detail)>task.requested_trucks) return `承接車數必須為 1～${task.requested_trucks} 的整數。`;
    const capacity=(await db.query('SELECT daily_capacity FROM partner_fleets WHERE id=$1',[fleet.id])).rows[0].daily_capacity;
    if(capacity>0 && Number(await usedCapacity(db,fleet.id,task.service_date,task.id))+Number(detail)>capacity) return '車隊當日承接量已達上限，請聯絡調度人員。';
    next='已確認';confirmed=Number(detail);
  }else if(kind==='拒絕'){
    if(task.status!=='待回覆') return '此任務已回覆，請聯絡調度人員修改。';
    if(!detail?.trim() || detail.trim().length>500) return '請填寫 1～500 字的拒絕原因。';
    next='已拒絕';confirmed=0;
  }else if(kind==='到站'){
    if(task.status!=='已確認') return '只有已確認承接的任務可以回報到站。';next='執行中';
  }else{
    if(task.status==='已完成') return '任務先前已完成，不會重複異動。';
    if(!['已確認','執行中'].includes(task.status)) return '請先確認承接，再回報完成。';next='已完成';
  }
  await db.query('UPDATE fleet_work_orders SET status=$1,confirmed_trucks=$2,updated_at=clock_timestamp() WHERE id=$3',[next,confirmed,task.id]);
  await audit(db,actor,kind,'車隊任務',task.id,detail||'');await enqueueSheet(db,'tasks',task.id);
  return `${taskNumber(task.id)} 已更新為${next}，管理端已同步。`;
}
module.exports={enqueueSheet,usedCapacity,queueNotification,addIncident,handleFleetGroupEvent,codeHash,taskNumber,caseNumber,parseTask};
