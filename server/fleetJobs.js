const {pool}=require('./db');
const {transaction}=require('./transaction');
const {isConfigured,pushMessage}=require('./line');
const {deliverSheet}=require('./fleetSheets');
const {taskNumber}=require('./fleetOperations');
const error=code=>Object.assign(new Error(code),{code});
async function deliverLine(job){
  if(!isConfigured()) throw error('LINE_NOT_CONFIGURED');
  if(job.payload.type==='delivery')return require('./deliveryLine').deliver(job);
  if(job.payload.type==='shopee')return deliverShopeeLine(job);
  const task=(await pool.query(`SELECT t.*,f.name AS fleet_name,f.status AS fleet_status,g.group_id
    FROM fleet_work_orders t JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN line_fleet_groups g ON g.fleet_id=t.fleet_id WHERE t.id=$1`,[job.payload.taskId])).rows[0];
  if(!task || task.fleet_status!=='啟用' || task.group_id!==job.payload.groupId || task.updated_at.toISOString()!==job.payload.version || ['已取消','已完成','已拒絕'].includes(task.status)) throw error('TASK_OR_GROUP_CHANGED');
  if(job.first_send_at && Date.now()-new Date(job.first_send_at).getTime()>23*3600000) throw error('RETRY_WINDOW_EXPIRED');
  await pool.query('UPDATE fleet_delivery_jobs SET first_send_at=COALESCE(first_send_at,NOW()) WHERE id=$1',[job.id]);
  const number=taskNumber(task.id);
  const text=`【Wayan 車隊任務】${number}\n車隊：${task.fleet_name}\n任務：${task.title}\n日期：${task.service_date}\n路線：${task.origin}→${task.destination}\n車型：${task.vehicle_type}，需求 ${task.requested_trucks} 車\n備註：${task.note||'無'}\n\n請回覆「承接 ${number} 車數」或「拒絕 ${number} 原因」\n到站：到站 ${number}\n完成：完成 ${number}\n異常：異常 ${number} 說明`;
  await pushMessage(task.group_id,text,{retryKey:job.id});
}
async function deliverShopeeLine(job){
  const a=(await pool.query(`SELECT a.*,r.service_date,r.origin,r.destination,r.vehicle_type,f.status AS fleet_status,g.group_id
    FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id JOIN partner_fleets f ON f.id=a.fleet_id LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id WHERE a.id=$1`,[job.payload.assignmentId])).rows[0];
  if(!a||a.fleet_status!=='啟用'||a.group_id!==job.payload.groupId||a.updated_at.toISOString()!==job.payload.version||a.status==='已拒絕')throw error('TASK_OR_GROUP_CHANGED');
  if(job.first_send_at&&Date.now()-new Date(job.first_send_at).getTime()>23*3600000)throw error('RETRY_WINDOW_EXPIRED');
  await pool.query('UPDATE fleet_delivery_jobs SET first_send_at=COALESCE(first_send_at,NOW()) WHERE id=$1',[job.id]);
  const n=require('./shopeeCheckins').number(a.id);
  await pushMessage(a.group_id,`【Wayan 蝦皮車趟】${n}\n${a.service_date} ${a.origin}→${a.destination}\n車型：${a.vehicle_type}\n要求 ${a.requested_trucks} 趟／已承接 ${a.confirmed_trucks} 趟\n蝦皮承接 ${n} 趟數\n蝦皮拒絕 ${n} 原因\n蝦皮報到 目前累計總車數\n例如：蝦皮報到 5\n查詢：蝦皮任務`,{retryKey:job.id});
}
async function runJobs(options={}){
  const results=[];
  for(let n=0;n<(options.limit||3);n++){
    const job=await transaction(pool,async db=>{
      const row=(await db.query(`SELECT * FROM fleet_delivery_jobs WHERE attempts<5 AND
        ((status IN ('pending','failed','blocked') AND next_attempt_at<=NOW()) OR (status='processing' AND locked_until<NOW()))
        ORDER BY CASE WHEN kind='line' THEN 0 WHEN payload->>'key' IN ('incidents','history') THEN 1 ELSE 2 END,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if(!row) return null;
      return (await db.query(`UPDATE fleet_delivery_jobs SET status='processing',attempts=attempts+1,claimed_revision=revision,
        locked_until=NOW()+INTERVAL '60 seconds',updated_at=NOW() WHERE id=$1 RETURNING *`,[row.id])).rows[0];
    });
    if(!job) break;
    try{
      if(job.kind==='line') await (options.deliverLine||deliverLine)(job);
      else await (options.deliverSheet||deliverSheet)(job.payload);
      await pool.query(`UPDATE fleet_delivery_jobs SET status=CASE WHEN revision=claimed_revision THEN 'sent' ELSE 'pending' END,
        next_attempt_at=NOW(),locked_until=NULL,error_code=NULL,updated_at=NOW() WHERE id=$1 AND claimed_revision=$2 AND status='processing'`,[job.id,job.claimed_revision]);
      results.push({id:job.id,status:'sent'});
    }catch(err){
      const code=/^[A-Z_]+$/.test(err.code||'')?err.code:'DELIVERY_FAILED';
      const blocked=['GOOGLE_NOT_CONFIGURED','LINE_NOT_CONFIGURED'].includes(code);
      const permanent=['TASK_OR_GROUP_CHANGED','RETRY_WINDOW_EXPIRED','SHEET_HEADERS_CHANGED','SHEET_ROW_CONFLICT'].includes(code);
      await pool.query(`UPDATE fleet_delivery_jobs SET status=$2,attempts=CASE WHEN $3 THEN attempts-1 WHEN $4 THEN 5 ELSE attempts END,
        next_attempt_at=NOW()+INTERVAL '60 seconds',locked_until=NULL,error_code=$5,updated_at=NOW() WHERE id=$1 AND claimed_revision=$6 AND status='processing'`,[job.id,blocked?'blocked':'failed',blocked,permanent,code,job.claimed_revision]);
      results.push({id:job.id,status:blocked?'blocked':'failed',error:code});
    }
  }
  return results;
}
function startFleetWorker(){
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await runJobs();}catch{console.error('FLEET_WORKER_ERROR');}finally{running=false;}};
  const timer=setInterval(tick,15000);timer.unref();return ()=>clearInterval(timer);
}
module.exports={runJobs,startFleetWorker,deliverLine};
