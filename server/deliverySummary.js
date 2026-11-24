const crypto=require('node:crypto');
const {pool}=require('./db'),{audit}=require('./transaction');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{summaryStatus:status});};
const versionSql=`to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function validate(items){if(!Array.isArray(items)||!items.length||items.length>50||new Set(items.map(x=>String(x?.tripId))).size!==items.length||items.some(x=>!x||!/^\d{1,15}$/.test(String(x.tripId))||typeof x.version!=='string'||x.version.length>40||typeof x.groupId!=='string'||!x.groupId||x.groupId.length>100))fail('請選擇1～50個不同車趟，並核對版本與群組',400);}
async function prepare(db,items){
 validate(items);
 const rows=(await db.query(`SELECT t.*,(SELECT alias FROM delivery_checkin_aliases WHERE trip_id=t.id) AS checkin_code,${versionSql} AS dispatch_version,w.name AS warehouse_name,p.name AS pickup_point_name,f.name AS fleet_name,f.status AS fleet_status,g.group_id,r.label AS group_name,r.bot_present FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id LEFT JOIN delivery_pickup_points p ON p.id=t.pickup_point_id LEFT JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN line_fleet_groups g ON g.fleet_id=t.fleet_id LEFT JOIN line_group_registry r ON r.group_id=g.group_id WHERE t.id=ANY($1::bigint[]) ORDER BY t.departure_time,t.task_code`,[items.map(x=>x.tripId)])).rows;
 if(rows.length!==items.length)fail('車趟不存在',404);
 for(const t of rows){const x=items.find(x=>String(x.tripId)===String(t.id));if(t.dispatch_version!==x.version)fail('車趟已變更，請重新預覽');if(t.group_id!==x.groupId||!t.bot_present||t.fleet_status!=='啟用')fail('群組綁定或Bot狀態已變更，請重新核對');if(['已取消','已完成'].includes(t.status))fail('已結束車趟不能發布');if((t.is_simulated||String(t.note||'').startsWith('[模擬]'))&&!await require('./stagingRouteAcceptance').allowed(db,t))fail('模擬車趟禁止發送LINE通知');}
 if(new Set(rows.map(t=>t.group_id)).size!==1||new Set(rows.map(t=>t.service_date)).size!==1||new Set(rows.map(t=>t.fleet_id)).size!==1)fail('每次請選擇同一日期、同一車隊群組');
 const routeCounts=(await db.query("SELECT upper(trim(s.route_code)) AS route,count(DISTINCT t.id)::int AS n FROM delivery_trips t JOIN delivery_trip_stops s ON s.trip_id=t.id WHERE t.fleet_id=$1 AND t.service_date=$2 AND t.status NOT IN ('已取消','已完成') AND s.released_at IS NULL GROUP BY upper(trim(s.route_code))",[rows[0].fleet_id,rows[0].service_date])).rows;
 const stops=(await db.query('SELECT * FROM delivery_trip_stops WHERE trip_id=ANY($1::bigint[]) AND released_at IS NULL ORDER BY trip_id,stop_no',[rows.map(t=>t.id)])).rows;
 for(const t of rows){const list=stops.filter(s=>String(s.trip_id)===String(t.id)),codes=[...new Set(list.map(s=>String(s.route_code||'').trim().toUpperCase()))];t.route=codes.length===1&&codes[0]?codes[0]:null;t.use_task_code=routeCounts.some(r=>r.route===t.route&&r.n>1);t.store_count=new Set(list.map(s=>s.store_code||s.store_name+'|'+s.address)).size;}
 return {rows,items:rows.map(t=>({tripId:String(t.id),version:t.dispatch_version,groupId:t.group_id})),text:format(rows)};
}
function format(rows){
 const counts=new Map();for(const t of rows)if(t.route)counts.set(t.route,(counts.get(t.route)||0)+1);
 const lines=rows.map((t,i)=>{const code=t.route&&counts.get(t.route)===1&&!t.use_task_code?t.route:t.task_code,managed=require('./driverRouteClaims').managed(t);return `${i+1}. ${code}\n   ${t.departure_time}｜${t.pickup_point_name||t.warehouse_name}｜${t.store_count}店`+(managed?'':`\n   報到：車趟報到 ${t.checkin_code||t.task_code}`);});
 const managed=rows.some(t=>require('./driverRouteClaims').managed(t));
 return `【蝦皮任務｜${rows[0].fleet_name}】\n${rows[0].service_date}｜${rows.length}趟・${rows.reduce((n,t)=>n+t.store_count,0)}店\n\n`+lines.join('\n\n')+(managed?'\n\n接取：接取 路線編號 司機ID\n請先完成司機LINE綁定；接取後依Bot指引私訊查看完整站點。':'')+'\n※ 店數依各趟合計；本清單不含逐站地址。';
}
async function queue(db,items,actor){
 const prepared=await prepare(db,items),fresh=[];let duplicate=0;
 for(const t of prepared.rows){const x=prepared.items.find(x=>x.tripId===String(t.id)),prior=await db.query("SELECT 1 FROM fleet_delivery_jobs WHERE kind='line' AND payload->>'type'='deliverySummary' AND payload->>'groupId'=$1 AND payload->'items' @> $2::jsonb LIMIT 1",[t.group_id,JSON.stringify([x])]);if(prior.rowCount)duplicate++;else fresh.push(t);}
 if(!fresh.length)return {queued:0,duplicate,messages:0};
 const refs=prepared.items.filter(x=>fresh.some(t=>String(t.id)===x.tripId)).sort((a,b)=>a.tripId.localeCompare(b.tripId)),groupId=fresh[0].group_id;
 const key='line:delivery-summary:'+crypto.createHash('sha256').update(JSON.stringify(refs)).digest('hex'),id=crypto.randomUUID();
 const r=await db.query("INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload) VALUES($1,$2,'line',$3) ON CONFLICT(job_key) DO NOTHING RETURNING id",[id,key,{type:'deliverySummary',groupId,items:refs,text:format(fresh)}]);
 if(r.rowCount)await audit(db,actor,'排入LINE任務簡表','蝦皮門店車趟',id,`${fresh.length}趟／同群組合併清單`);
 return {queued:r.rowCount?fresh.length:0,duplicate:duplicate+(r.rowCount?0:fresh.length),messages:r.rowCount?1:0};
}
async function deliver(job){
 const line=require('./line');if(!line.isConfigured())throw Object.assign(new Error('LINE_NOT_CONFIGURED'),{code:'LINE_NOT_CONFIGURED'});
 try{await prepare(pool,job.payload.items);}catch(e){if(e.summaryStatus)throw Object.assign(new Error('TASK_OR_GROUP_CHANGED'),{code:'TASK_OR_GROUP_CHANGED'});throw e;}
 if(job.first_send_at&&Date.now()-new Date(job.first_send_at).getTime()>23*3600000)throw Object.assign(new Error('RETRY_WINDOW_EXPIRED'),{code:'RETRY_WINDOW_EXPIRED'});
 await pool.query('UPDATE fleet_delivery_jobs SET first_send_at=COALESCE(first_send_at,NOW()) WHERE id=$1',[job.id]);
 await line.pushMessage(job.payload.groupId,job.payload.text,{retryKey:job.id});
}
module.exports={prepare,queue,deliver,format};
