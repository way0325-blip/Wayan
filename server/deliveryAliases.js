const crypto=require('node:crypto');const {todayInTaipei}=require('./dates');const {audit}=require('./transaction');
const normalize=value=>String(value||'').normalize('NFKC').trim().toUpperCase();
const valid=value=>typeof value==='string'&&/^[\p{Script=Han}A-Z0-9_-]{1,40}$/u.test(value);
const fail=message=>{throw Object.assign(new Error(message),{aliasError:true});};
async function setAliases(db,body,actor){const rows=body?.items,reason=typeof body?.reason==='string'?body.reason.trim():'';
 if(!Array.isArray(rows)||!rows.length||rows.length>200||!reason||reason.length>500||rows.some(x=>!x||!/^\d{1,15}$/.test(String(x.tripId))||!valid(normalize(x.alias))||typeof x.version!=='string'||x.version.length>40)||new Set(rows.map(x=>String(x.tripId))).size!==rows.length||new Set(rows.map(x=>normalize(x.alias))).size!==rows.length)fail('需1～200個不同車趟、不重複中英文代號、版本及設定原因');
 const list=(await db.query(`SELECT t.*,to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version,a.alias AS old_alias FROM delivery_trips t LEFT JOIN delivery_checkin_aliases a ON a.trip_id=t.id WHERE t.id=ANY($1::bigint[]) ORDER BY t.id FOR UPDATE OF t`,[rows.map(x=>x.tripId)])).rows;
 if(list.length!==rows.length||new Set(list.map(t=>t.service_date)).size!==1)fail('車趟需存在且為同一作業日期');
 const batchKey=crypto.randomUUID(),ids=rows.map(x=>String(x.tripId));
 for(const t of list){const x=rows.find(x=>String(x.tripId)===String(t.id));if(x.version!==t.version)fail('車趟已更新，請重新整理');if(!['待派車','已派車'].includes(t.status)||(await db.query('SELECT 1 FROM delivery_checkins WHERE trip_id=$1 LIMIT 1',[t.id])).rowCount)fail('已出發或已有報到的車趟不可變更代號');
  const conflict=await db.query(`SELECT 1 FROM delivery_trips o LEFT JOIN delivery_checkin_aliases a ON a.trip_id=o.id WHERE o.service_date=$1 AND o.id<>$2 AND (upper(o.task_code)=$3 OR (a.alias=$3 AND NOT(o.id=ANY($4::bigint[])))) LIMIT 1`,[t.service_date,t.id,normalize(x.alias),ids]);if(conflict.rowCount)fail('此日期已有相同代號或車趟編號');
 }
 await db.query('SET CONSTRAINTS delivery_alias_day_unique DEFERRED');
 for(const t of list){const x=rows.find(x=>String(x.tripId)===String(t.id)),alias=normalize(x.alias);await db.query(`INSERT INTO delivery_checkin_aliases(trip_id,service_date,alias,batch_key,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(trip_id) DO UPDATE SET alias=EXCLUDED.alias,batch_key=EXCLUDED.batch_key,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,[t.id,t.service_date,alias,batchKey,actor.username]);await db.query('UPDATE delivery_trips SET updated_at=clock_timestamp() WHERE id=$1',[t.id]);await audit(db,actor,'設定報到代號','蝦皮門店車趟',t.id,JSON.stringify({before:t.old_alias||'',after:alias,reason}));}
 return {updated:list.length,batchKey,items:list.map(t=>({tripId:t.id,alias:normalize(rows.find(x=>String(x.tripId)===String(t.id)).alias)}))};
}
async function resolve(db,value,fleetId,lock=false){const key=normalize(value);if(!valid(key))return null;
 const rows=(await db.query(`SELECT t.*,w.name AS warehouse_name,a.alias AS checkin_code,a.batch_key FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id LEFT JOIN delivery_checkin_aliases a ON a.trip_id=t.id WHERE t.fleet_id=$1 AND (upper(t.task_code)=$2 OR (a.alias=$2 AND a.service_date=$3)) LIMIT 2 ${lock?'FOR UPDATE OF t':''}`,[fleetId,key,todayInTaipei()])).rows;
 return rows.length===1?rows[0]:null;
}
async function totals(db,t){if(!t.batch_key)return '';const r=(await db.query(`SELECT COALESCE(SUM(t.required_checkins),0)::int AS required,COALESCE(SUM((SELECT count(*) FROM delivery_checkins c WHERE c.trip_id=t.id)),0)::int AS reported FROM delivery_checkin_aliases a JOIN delivery_trips t ON t.id=a.trip_id WHERE a.batch_key=$1 AND t.fleet_id=$2 AND t.service_date=$3 AND t.status<>'已取消'`,[t.batch_key,t.fleet_id,t.service_date])).rows[0];return `\n本批需求 ${r.required}／已報到 ${r.reported}／尚缺 ${Math.max(0,r.required-r.reported)}`;}
function register(router,db){router.post('/checkin-aliases',async(req,res,next)=>{try{res.json(await setAliases(db,req.body,req.user));}catch(e){if(e.aliasError||e.code==='23505')return res.status(409).json({error:e.aliasError?e.message:'代號重複，本次未寫入'});next(e);}});}
module.exports={normalize,valid,setAliases,resolve,totals,register};
