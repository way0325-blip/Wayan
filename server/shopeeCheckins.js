const crypto=require('node:crypto');
const {audit}=require('./transaction');
const {todayInTaipei}=require('./dates');
const number=id=>'S'+String(id).padStart(6,'0');
async function reportedTotal(db,fleetId,day){return Number((await db.query('SELECT reported_total FROM shopee_fleet_reports WHERE fleet_id=$1 AND service_date=$2 ORDER BY id DESC LIMIT 1',[fleetId,day])).rows[0]?.reported_total||0);}
async function assignment(db,id,fleetId=null){return (await db.query(`SELECT a.*,r.service_date,r.origin,r.destination,r.vehicle_type,r.required_trucks,r.note AS route_note,r.is_simulated AS route_simulated,f.name AS fleet_name,f.status AS fleet_status,g.group_id FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id JOIN partner_fleets f ON f.id=a.fleet_id LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id WHERE a.id=$1 AND ($2::text IS NULL OR a.fleet_id=$2) FOR UPDATE OF a`,[id,fleetId])).rows[0];}
async function reportTotal(db,fleetId,day,body,actor,eventId=null){
  // The caller holds the shared dispatch/group lock 870033 for the entire transaction.
  const total=typeof body.total==='boolean'||body.total===''||body.total===null?NaN:Number(body.total),note=typeof body.note==='string'?body.note.trim():'';
  if(!Number.isInteger(total)||total<0||total>200000)return {error:'累計總車數須為 0～200000 的整數',status:400};
  if(day!==todayInTaipei())return {error:'僅可回報台灣時間今日的累計總車數',status:409};
  const fleet=(await db.query('SELECT * FROM partner_fleets WHERE id=$1 FOR SHARE',[fleetId])).rows[0];
  if(!fleet||fleet.status!=='啟用')return {error:'車隊不存在或已停用',status:409};
  const limits=(await db.query(`SELECT count(*)::int AS tasks,COALESCE(SUM(a.confirmed_trucks),0)::int AS confirmed FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id WHERE a.fleet_id=$1 AND r.service_date=$2 AND a.status='已確認'`,[fleetId,day])).rows[0];
  if(!limits.tasks)return {error:'今日尚無已確認承接的蝦皮任務，請先確認承接',status:409};
  if(total>limits.confirmed)return {error:`回報總數不可超過今日確認承接 ${limits.confirmed} 車，請聯絡調度核對`,status:409};
  const last=(await db.query('SELECT * FROM shopee_fleet_reports WHERE fleet_id=$1 AND service_date=$2 ORDER BY id DESC LIMIT 1',[fleetId,day])).rows[0];
  if(last&&last.reported_total===total)return {duplicate:true,report:last};
  const correction=last&&total<last.reported_total;
  if(correction&&actor.role!=='admin')return {error:'累計總數不可降低，請由管理員填寫原因更正',status:409};
  if(!eventId&&(!note||note.length>500))return {error:'人工補登或更正請填寫 1～500 字原因',status:400};
  const row=(await db.query(`INSERT INTO shopee_fleet_reports(fleet_id,service_date,reported_total,source,reported_by,line_event_id,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[fleetId,day,total,eventId?'LINE':correction?'管理員更正':'調度補登',actor.username,eventId,note])).rows[0];
  await audit(db,actor,correction?'更正累計報到':'回報累計總車數','蝦皮報到',row.id,`${fleetId} ${day} ${last?.reported_total??0}→${total} ${note}`);
  return {duplicate:false,report:row};
}
async function queueShopeeNotification(db,a,actor){
  if(a.route_simulated||String(a.route_note||'').startsWith('[模擬]'))return {error:'模擬路線禁止LINE通知',status:409};
  if(!a.group_id||a.fleet_status!=='啟用'||a.status==='已拒絕')return {error:'車隊須啟用並綁定群組，且任務未拒絕',status:409};
  const version=a.updated_at.toISOString();
  const r=await db.query(`INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload) VALUES($1,$2,'line',$3) ON CONFLICT(job_key) DO NOTHING RETURNING id`,[crypto.randomUUID(),`line:shopee:${a.id}:${version}:${a.group_id}`,{type:'shopee',assignmentId:a.id,groupId:a.group_id,version}]);
  if(r.rowCount)await audit(db,actor,'排入LINE通知','蝦皮分派',a.id,number(a.id));return {queued:r.rowCount===1,duplicate:r.rowCount===0};
}
async function handleShopeeGroup(db,text,fleet,actor,eventId){
  if(text==='蝦皮任務'){
    const day=todayInTaipei(),rows=(await db.query(`SELECT a.*,r.origin,r.destination FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id WHERE a.fleet_id=$1 AND r.service_date=$2 AND a.status<>'已拒絕' ORDER BY a.id LIMIT 30`,[fleet.id,day])).rows;
    const total=await reportedTotal(db,fleet.id,day);
    return `【${fleet.name} 今日蝦皮任務】${day}\n目前累計報到 ${total} 車\n`+(rows.map(a=>`${number(a.id)} ${a.origin}→${a.destination} 要求${a.requested_trucks}趟／承接${a.confirmed_trucks}趟 ${a.status}`).join('\n')||'目前無今日任務。')+'\n回報：蝦皮報到 目前累計總車數（例如：蝦皮報到 5）';
  }
  const reported=text.match(/^蝦皮報到\s+(\d+)$/);
  if(reported){
    const r=await reportTotal(db,fleet.id,todayInTaipei(),{total:Number(reported[1])},actor,eventId);
    return r.error||`【${fleet.name}】${r.duplicate?'相同總數已登記，不會重複累加':'已更新'}：今日累計報到 ${r.report.reported_total} 車。管理端已同步。`;
  }
  if(!text.startsWith('蝦皮'))return null;
  const m=text.match(/^蝦皮(承接|拒絕)\s+S0*([1-9]\d{0,8})(?:\s+(.+))?$/i);
  if(!m)return '蝦皮任務\n蝦皮承接 S任務編號 趟數\n蝦皮拒絕 S任務編號 原因\n蝦皮報到 目前累計總車數（例如：蝦皮報到 5）';
  const [,kind,id,detail]=m,a=await assignment(db,id,fleet.id);
  if(!a)return '找不到本車隊的蝦皮任務。';
  if(a.status!=='待回覆')return '此任務已回覆，請由調度人員核對變更。';
  let n=0;
  if(kind==='承接'){
    if(!/^\d+$/.test(detail||'')||Number(detail)<1||Number(detail)>a.requested_trucks)return `承接趟數須為 1～${a.requested_trucks}。`;
    n=Number(detail);const {usedCapacity}=require('./fleetOperations');
    const cap=(await db.query('SELECT daily_capacity FROM partner_fleets WHERE id=$1',[fleet.id])).rows[0].daily_capacity;
    if(cap>0&&Number(await usedCapacity(db,fleet.id,a.service_date))>cap)return '當日承接上限不足，請聯絡調度。';
    const others=Number((await db.query("SELECT COALESCE(SUM(confirmed_trucks),0) n FROM shopee_assignments WHERE route_id=$1 AND id<>$2 AND status='已確認'",[a.route_id,a.id])).rows[0].n);
    if(others+n+await require('./deliveryDispatch').ownCount(db,a.route_id)>a.required_trucks)return '承接總數超過路線需求，請聯絡調度。';
    const linked=Number((await db.query("SELECT count(*) n FROM delivery_trips WHERE assignment_id=$1 AND status<>'已取消'",[a.id])).rows[0].n);if(a.delivery_managed&&n<linked)return '已規劃車趟多於承接數，請調度先調整分派再承接。';
  }else if(!detail?.trim()||detail.length>500)return '拒絕任務請提供 1～500 字原因。';
  await db.query('UPDATE shopee_assignments SET confirmed_trucks=$2,status=$3,updated_at=clock_timestamp() WHERE id=$1',[a.id,n,n?'已確認':'已拒絕']);
  await audit(db,actor,kind,'蝦皮承接',a.id,detail);return `${number(a.id)} 已登記${kind} ${n} 趟。回報今日累計總車數請輸入「蝦皮報到 總數」。`;
}
module.exports={assignment,reportTotal,reportedTotal,handleShopeeGroup,queueShopeeNotification,number};
