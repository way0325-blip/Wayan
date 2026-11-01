const express=require('express');
const crypto=require('node:crypto');
const {pool:rawPool}=require('../db');
const {requireAuth,requireRole}=require('../auth');
const {transactionalRouter}=require('../transactionalRouter');
const {isValidDateKey}=require('../dates');
const {codeHash,enqueueSheet,usedCapacity,queueNotification,addIncident,taskNumber,caseNumber}=require('../fleetOperations');
const {targetId,credentialsReady}=require('../fleetSheets');
const {isConfigured}=require('../line');
const router=express.Router();
const {pool,logAction}=transactionalRouter(router,rawPool,870033);
router.use(requireAuth,requireRole('admin','dispatcher'));
const admin=requireRole('admin');
router.get('/activity-status',async(req,res,next)=>{try{
  res.set('Cache-Control','no-store').json((await pool.query(`SELECT f.id,f.name,f.status,g.group_id IS NOT NULL AS bound,r.label AS group_name,r.bot_present,r.last_seen_at,
    (SELECT MAX(a.received_at) FROM fleet_line_activity a WHERE a.fleet_id=f.id) AS last_activity
    FROM partner_fleets f LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id LEFT JOIN line_group_registry r ON r.group_id=g.group_id ORDER BY f.name LIMIT 1000`)).rows);
}catch(e){next(e);}});
router.get('/activity',async(req,res,next)=>{try{
  const fleetId=req.query.fleetId||'';if(typeof fleetId!=='string'||fleetId.length>100)return res.status(400).json({error:'車隊篩選無效'});
  let before=null;
  if(req.query.before){try{before=JSON.parse(Buffer.from(req.query.before,'base64url').toString());if(typeof before.time!=='string'||Number.isNaN(Date.parse(before.time))||typeof before.id!=='string'||before.id.length>200)throw Error();}catch{return res.status(400).json({error:'分頁游標無效'});}}
  const rows=(await pool.query(`SELECT a.event_id,a.fleet_id,f.name AS fleet_name,a.received_at,
    to_char(a.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
    a.event_type,a.message_type,a.content,a.sender_label,a.hidden,e.status,e.delivery_status,
    CASE WHEN a.hidden THEN NULL ELSE e.reply_text END AS reply_text
    FROM fleet_line_activity a JOIN partner_fleets f ON f.id=a.fleet_id JOIN line_events e ON e.event_id=a.event_id
    WHERE ($1='' OR a.fleet_id=$1) AND ($2::timestamptz IS NULL OR (a.received_at,a.event_id)<($2::timestamptz,$3))
    ORDER BY a.received_at DESC,a.event_id DESC LIMIT 51`,[fleetId,before?.time||null,before?.id||''])).rows;
  const last=rows[49];res.set('Cache-Control','no-store').json({items:rows.slice(0,50),nextCursor:rows.length>50?Buffer.from(JSON.stringify({time:last.cursor_time,id:last.event_id})).toString('base64url'):null});
}catch(e){next(e);}});
router.get('/keywords',admin,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json((await pool.query('SELECT * FROM line_keyword_replies ORDER BY keyword')).rows);}catch(e){next(e);}});
router.put('/keywords',admin,async(req,res,next)=>{try{
  const {keyword,reply,enabled}=req.body||{};
  if(typeof keyword!=='string'||keyword!==keyword.trim()||!keyword||keyword.length>30||/\s/.test(keyword)||typeof reply!=='string'||!reply.trim()||reply.length>1500||typeof enabled!=='boolean')return res.status(400).json({error:'關鍵字需為1～30字且無空白，回覆需為1～1500字，並指定啟用狀態'});
  if(require('../lineKeywords').reserved.has(keyword))return res.status(409).json({error:'這是內建任務或報到指令，不能改成文字回覆'});
  if(!(await pool.query('SELECT 1 FROM line_keyword_replies WHERE keyword=$1',[keyword])).rowCount&&(await pool.query('SELECT count(*)::int n FROM line_keyword_replies')).rows[0].n>=100)return res.status(409).json({error:'關鍵字最多100組，請編輯或停用既有項目'});
  const r=(await pool.query(`INSERT INTO line_keyword_replies(keyword,reply,enabled,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(keyword) DO UPDATE SET reply=EXCLUDED.reply,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[keyword,reply.trim(),enabled,req.user.username])).rows[0];
  await logAction(req,'設定關鍵字回覆','LINE關鍵字',keyword,enabled?'啟用':'停用');res.json(r);
}catch(e){next(e);}});
const clean=(v,max)=>typeof v==='string' && v.trim().length<=max?v.trim():null;
const idOk=id=>/^\d{1,15}$/.test(id||'');
const statuses=['待回覆','已確認','已拒絕','執行中','已完成','已取消'];
const caseStatuses=['待處理','處理中','待確認','已結案'];
router.get('/groups',admin,async(req,res,next)=>{try{
  res.set('Cache-Control','no-store').json((await pool.query(`SELECT r.*,g.fleet_id,f.name AS fleet_name,
    (SELECT count(*)::int FROM line_events e WHERE e.payload->'source'->>'groupId'=r.group_id AND (e.status='failed' OR e.delivery_status='failed')) AS failed_events,
    (SELECT count(*)::int FROM fleet_delivery_jobs j WHERE j.payload->>'groupId'=r.group_id AND j.status='failed') AS failed_notifications
    FROM line_group_registry r LEFT JOIN line_fleet_groups g ON g.group_id=r.group_id LEFT JOIN partner_fleets f ON f.id=g.fleet_id ORDER BY r.label,r.group_id LIMIT 1000`)).rows);
}catch(e){next(e);}});
router.post('/groups/import',admin,async(req,res,next)=>{try{
  const rows=req.body?.groups;
  if(!Array.isArray(rows)||!rows.length||rows.length>100||rows.some(g=>!/^C[0-9a-f]{32}$/i.test(g.groupId||'')||!clean(g.name,100)))return res.status(400).json({error:'每次限 1～100 群組，需填名稱及 C 開頭的 33 碼 LINE Group ID；邀請連結不是 Group ID'});
  for(const g of rows)await pool.query(`INSERT INTO line_group_registry(group_id,label,created_by) VALUES($1,$2,$3) ON CONFLICT(group_id) DO UPDATE SET label=EXCLUDED.label`,[g.groupId,g.name.trim(),req.user.username]);
  await logAction(req,'匯入群組清單','LINE群組','',`${rows.length} 筆；保留原驗證狀態`);res.json({imported:rows.length});
}catch(e){next(e);}});
router.post('/fleets/:id/group',admin,async(req,res,next)=>{try{
  const error=await require('../lineGroups').bindSelectedGroup(pool,req.body?.groupId,req.params.id,req.user);
  if(error)return res.status(409).json({error});res.json({bound:true});
}catch(e){next(e);}});
router.get('/status',async(req,res,next)=>{
  try{
    const counts=(await pool.query(`SELECT
      (SELECT count(*)::int FROM partner_fleets WHERE status='啟用') AS active_fleets,
      (SELECT count(*)::int FROM line_fleet_groups) AS bound_groups,
      (SELECT count(*)::int FROM fleet_work_orders WHERE status='待回覆') AS pending_tasks,
      (SELECT count(*)::int FROM fleet_incidents WHERE status<>'已結案') AS open_incidents,
      (SELECT count(*)::int FROM fleet_delivery_jobs WHERE status='blocked') AS blocked_jobs,
      (SELECT count(*)::int FROM fleet_delivery_jobs WHERE status='failed') AS failed_jobs`)).rows[0];
    const sheetId=await targetId();
    res.set('Cache-Control','no-store').json({...counts,lineConfigured:isConfigured(),sheetId,sheetConfigured:credentialsReady() && Boolean(sheetId),sheetUrl:sheetId?'https://docs.google.com/spreadsheets/d/'+sheetId+'/edit':null,writerEmail:req.user.role==='admin'?process.env.WAYAN_GOOGLE_CLIENT_EMAIL||'':undefined});
  }catch(err){next(err);}
});
router.get('/fleets',async(req,res,next)=>{
  const query=clean(req.query.q||'',100),after=clean(req.query.after||'',100);
  if(query===null || after===null)return res.status(400).json({error:'查詢格式錯誤'});
  try{
    const rows=(await pool.query(`SELECT f.id,f.name,f.contact_name,f.phone,f.daily_capacity,f.status,
      (g.group_id IS NOT NULL) AS group_bound FROM partner_fleets f LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id
      WHERE (f.name ILIKE '%'||$1||'%' OR f.id ILIKE '%'||$1||'%') AND f.id>$2 ORDER BY f.id LIMIT 51`,[query,after])).rows;
    res.json({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null});
  }catch(err){next(err);}
});
router.post('/fleets/:id/group-code',admin,async(req,res,next)=>{
  try{
    const fleet=(await pool.query("SELECT * FROM partner_fleets WHERE id=$1 AND status='啟用'",[req.params.id])).rows[0];
    if(!fleet)return res.status(404).json({error:'找不到啟用中的車隊'});
    if((await pool.query('SELECT 1 FROM line_fleet_groups WHERE fleet_id=$1',[fleet.id])).rowCount)return res.status(409).json({error:'車隊已有綁定群組，請先解除'});
    const code=crypto.randomBytes(16).toString('base64url');
    const result=(await pool.query(`INSERT INTO fleet_group_codes(code_hash,fleet_id,expires_at,created_by) VALUES($1,$2,NOW()+INTERVAL '10 minutes',$3)
      ON CONFLICT(fleet_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by RETURNING expires_at`,[codeHash(code),fleet.id,req.user.username])).rows[0];
    await logAction(req,'產生群組綁定碼','夥伴車隊',fleet.id,'十分鐘有效，不紀錄原碼');
    res.status(201).json({command:'車隊群組綁定 '+code,expiresAt:result.expires_at});
  }catch(err){next(err);}
});
router.delete('/fleets/:id/group',admin,async(req,res,next)=>{
  try{
    await pool.query('DELETE FROM line_fleet_groups WHERE fleet_id=$1',[req.params.id]);
    await pool.query('DELETE FROM fleet_group_codes WHERE fleet_id=$1',[req.params.id]);
    await logAction(req,'解除群組綁定','夥伴車隊',req.params.id,'');await enqueueSheet(pool,'fleets',req.params.id);
    res.status(204).send();
  }catch(err){next(err);}
});
router.get('/tasks',async(req,res,next)=>{
  const fleetId=clean(req.query.fleetId||'',100),before=req.query.before||'9223372036854775807';
  if(fleetId===null || (req.query.before && !idOk(req.query.before)) || (req.query.status && !statuses.includes(req.query.status)))return res.status(400).json({error:'查詢格式錯誤'});
  try{
    const rows=(await pool.query(`SELECT t.*,f.name AS fleet_name FROM fleet_work_orders t JOIN partner_fleets f ON f.id=t.fleet_id
      WHERE ($1='' OR fleet_id=$1) AND t.id<$2::bigint AND ($3='' OR t.status=$3) ORDER BY t.id DESC LIMIT 101`,[fleetId,before,req.query.status||''])).rows;
    res.json({items:rows.slice(0,100).map(t=>({...t,number:taskNumber(t.id)})),nextCursor:rows.length>100?rows[99].id:null});
  }catch(err){next(err);}
});
router.post('/tasks',async(req,res,next)=>{
  const b=req.body||{},fields={fleetId:clean(b.fleetId,100),title:clean(b.title,100),serviceDate:clean(b.serviceDate,10),origin:clean(b.origin,100),destination:clean(b.destination,100),vehicleType:clean(b.vehicleType,50),note:clean(b.note??'',500)};
  const n=b.requestedTrucks;
  if(Object.entries(fields).some(([k,v])=>v===null || (k!=='note'&&!v)) || !isValidDateKey(fields.serviceDate) || typeof n!=='number' || !Number.isInteger(n)||n<1||n>200 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.requestId||''))return res.status(400).json({error:'請填寫有效任務資料、日期、1～200 整數車數及 requestId'});
  const hash=crypto.createHash('sha256').update(JSON.stringify({...fields,requestedTrucks:n})).digest('hex');
  try{
    const existing=(await pool.query('SELECT * FROM fleet_work_orders WHERE request_id=$1',[b.requestId])).rows[0];
    if(existing){if(existing.request_hash!==hash)return res.status(409).json({error:'同一請求編號不可使用不同資料'});return res.json({...existing,number:taskNumber(existing.id),duplicate:true});}
    const fleet=(await pool.query("SELECT * FROM partner_fleets WHERE id=$1 AND status='啟用'",[fields.fleetId])).rows[0];
    if(!fleet)return res.status(404).json({error:'找不到啟用中的車隊'});
    if(fleet.daily_capacity>0 && Number(await usedCapacity(pool,fleet.id,fields.serviceDate))+n>fleet.daily_capacity)return res.status(409).json({error:'超過車隊當日車數上限，已包含既有蝦皮分派'});
    const task=(await pool.query(`INSERT INTO fleet_work_orders(request_id,request_hash,fleet_id,title,service_date,origin,destination,vehicle_type,requested_trucks,note,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[b.requestId,hash,fleet.id,fields.title,fields.serviceDate,fields.origin,fields.destination,fields.vehicleType,n,fields.note,req.user.username])).rows[0];
    await logAction(req,'建立任務','車隊任務',task.id,task.title);await enqueueSheet(pool,'tasks',task.id);
    res.status(201).json({...task,number:taskNumber(task.id)});
  }catch(err){next(err);}
});
router.post('/tasks/:id/notify',async(req,res,next)=>{
  if(!idOk(req.params.id))return res.status(400).json({error:'任務編號格式錯誤'});
  try{
    const task=(await pool.query('SELECT * FROM fleet_work_orders WHERE id=$1',[req.params.id])).rows[0];
    if(!task)return res.status(404).json({error:'找不到任務'});
    const result=await queueNotification(pool,task,req.user);res.status(result.status||202).json(result);
  }catch(err){next(err);}
});
router.post('/tasks/:id/cancel',async(req,res,next)=>{
  const reason=clean(req.body?.reason,500);
  if(!idOk(req.params.id)||!reason)return res.status(400).json({error:'請填寫取消原因'});
  try{
    const row=(await pool.query("UPDATE fleet_work_orders SET status='已取消',updated_at=clock_timestamp() WHERE id=$1 AND status IN ('待回覆','已確認','已拒絕') RETURNING *",[req.params.id])).rows[0];
    if(!row)return res.status(409).json({error:'執行中或已結束任務不能取消'});
    await logAction(req,'取消任務','車隊任務',row.id,reason);await enqueueSheet(pool,'tasks',row.id);res.json(row);
  }catch(err){next(err);}
});
router.get('/incidents',async(req,res,next)=>{
  const fleetId=clean(req.query.fleetId||'',100),before=req.query.before||'9223372036854775807';
  if(fleetId===null || (req.query.before&&!idOk(req.query.before)) || (req.query.status&&!caseStatuses.includes(req.query.status)))return res.status(400).json({error:'查詢格式錯誤'});
  try{
    const rows=(await pool.query(`SELECT i.*,f.name AS fleet_name,d.task_code FROM fleet_incidents i JOIN partner_fleets f ON f.id=i.fleet_id LEFT JOIN delivery_trips d ON d.id=i.delivery_trip_id
      WHERE ($1='' OR i.fleet_id=$1) AND i.id<$2::bigint AND ($3='' OR i.status=$3) ORDER BY i.id DESC LIMIT 101`,[fleetId,before,req.query.status||''])).rows;
    res.json({items:rows.slice(0,100).map(i=>({...i,number:caseNumber(i.id),taskNumber:i.delivery_trip_id?i.task_code:i.task_id?taskNumber(i.task_id):'未指定車趟'})),nextCursor:rows.length>100?rows[99].id:null});
  }catch(err){next(err);}
});
router.get('/incidents/:id',async(req,res,next)=>{
  if(!idOk(req.params.id))return res.status(400).json({error:'案件編號格式錯誤'});
  try{
    const incident=(await pool.query(`SELECT i.*,f.name AS fleet_name,d.task_code,COALESCE(t.title,d.task_name,'車隊一般異常') AS task_title FROM fleet_incidents i JOIN partner_fleets f ON f.id=i.fleet_id LEFT JOIN fleet_work_orders t ON t.id=i.task_id LEFT JOIN delivery_trips d ON d.id=i.delivery_trip_id WHERE i.id=$1`,[req.params.id])).rows[0];
    if(!incident)return res.status(404).json({error:'找不到案件'});
    const history=(await pool.query('SELECT * FROM fleet_incident_history WHERE incident_id=$1 ORDER BY id',[incident.id])).rows;
    res.json({incident:{...incident,number:caseNumber(incident.id),taskNumber:incident.delivery_trip_id?incident.task_code:incident.task_id?taskNumber(incident.task_id):'未指定車趟'},history});
  }catch(err){next(err);}
});
router.post('/incidents',async(req,res,next)=>{
  const b=req.body||{},description=clean(b.description,1000);
  if(!idOk(String(b.taskId||''))||!description||!['延誤','車輛異常','貨損','事故','其他'].includes(b.kind))return res.status(400).json({error:'請填寫任務、異常類型及說明'});
  try{
    const task=(await pool.query('SELECT * FROM fleet_work_orders WHERE id=$1',[b.taskId])).rows[0];
    if(!task)return res.status(404).json({error:'找不到任務'});
    res.status(201).json(await addIncident(pool,task,b.kind,description,req.user));
  }catch(err){next(err);}
});
router.patch('/incidents/:id',async(req,res,next)=>{
  const b=req.body||{},note=clean(b.note,1000),handler=clean(b.handler??req.user.username,50),resolution=clean(b.resolution??'',1000);
  if(!idOk(req.params.id)||!note||!handler||resolution===null||!caseStatuses.includes(b.status))return res.status(400).json({error:'請填寫有效狀態、處理人及處理說明'});
  try{
    const current=(await pool.query('SELECT * FROM fleet_incidents WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!current)return res.status(404).json({error:'找不到案件'});
    if((b.status==='已結案'||current.status==='已結案')&&req.user.role!=='admin')return res.status(403).json({error:'結案及重開僅限管理員'});
    const transitions={'待處理':['處理中'],'處理中':['待確認'],'待確認':['處理中','已結案'],'已結案':['處理中']};
    if(b.status!==current.status&&!transitions[current.status].includes(b.status))return res.status(409).json({error:'請依待處理、處理中、待確認、已結案流程操作'});
    if(b.status==='已結案'&&(!resolution || current.status==='已結案'))return res.status(409).json({error:'結案前必須完成覆核及填寫處理結果'});
    const row=(await pool.query('UPDATE fleet_incidents SET status=$1,handler=$2,resolution=$3,updated_at=clock_timestamp() WHERE id=$4 RETURNING *',[b.status,handler,resolution||current.resolution,current.id])).rows[0];
    const history=(await pool.query(`INSERT INTO fleet_incident_history(incident_id,actor,action,previous_status,next_status,note)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[current.id,req.user.username,current.status===b.status?'補充紀錄':'變更狀態',current.status,b.status,note])).rows[0];
    await logAction(req,'處理異常','車隊異常',current.id,note);await enqueueSheet(pool,'incidents',current.id);await enqueueSheet(pool,'history',history.id);res.json(row);
  }catch(err){next(err);}
});
router.get('/jobs',admin,async(req,res,next)=>{
  try{res.json((await pool.query('SELECT id,kind,job_key,status,attempts,error_code,created_at,updated_at FROM fleet_delivery_jobs ORDER BY updated_at DESC LIMIT 100')).rows);}catch(err){next(err);}
});
router.post('/jobs/:id/retry',admin,async(req,res,next)=>{
  if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({error:'工作編號格式錯誤'});
  try{
    const row=(await pool.query(`UPDATE fleet_delivery_jobs SET status='pending',attempts=0,error_code=NULL,next_attempt_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND status IN ('failed','blocked') AND (kind<>'line' OR first_send_at IS NULL OR first_send_at>NOW()-INTERVAL '23 hours') RETURNING id`,[req.params.id])).rows[0];
    if(!row)return res.status(409).json({error:'工作不可重試，或 LINE 安全重試期限已過；請人工核對訊息'});
    await logAction(req,'重試外部同步','夥伴車隊',row.id,'');res.json({ok:true});
  }catch(err){next(err);}
});
router.put('/sheet-target',admin,async(req,res,next)=>{
  const value=clean(req.body?.spreadsheetId,200);
  if(!value||!/^[A-Za-z0-9_-]{10,200}$/.test(value))return res.status(400).json({error:'請填寫 Google Sheets 試算表 ID'});
  try{await pool.query("INSERT INTO settings(key,value) VALUES('fleet_spreadsheet_id',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[value]);await logAction(req,'設定試算表','夥伴車隊',null,'Google Sheets 目標已變更');res.json({ok:true});}catch(err){next(err);}
});
router.post('/sheet-resync',admin,async(req,res,next)=>{
  try{
    for(const [key,table] of [['fleets','partner_fleets'],['tasks','fleet_work_orders'],['incidents','fleet_incidents'],['history','fleet_incident_history'],['rules','penalty_rules'],['penalties','penalty_cases'],['penaltyHistory','penalty_case_history']]){
      await pool.query(`INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload)
        SELECT gen_random_uuid(),'sheet:'||$1||':'||id::text,'sheet',jsonb_build_object('key',$1::text,'id',id::text) FROM ${table} WHERE TRUE
        ON CONFLICT(job_key) DO UPDATE SET revision=fleet_delivery_jobs.revision+1,
        status=CASE WHEN fleet_delivery_jobs.status='processing' THEN 'processing' ELSE 'pending' END,
        attempts=CASE WHEN fleet_delivery_jobs.status='processing' THEN fleet_delivery_jobs.attempts ELSE 0 END,
        next_attempt_at=NOW(),updated_at=NOW(),error_code=NULL`,[key]);
    }
    await logAction(req,'排入完整同步','夥伴車隊',null,'');res.status(202).json({queued:true});
  }catch(err){next(err);}
});
module.exports=router;
