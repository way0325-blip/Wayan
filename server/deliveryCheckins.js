const crypto=require('node:crypto');
const {audit}=require('./transaction');
const {todayInTaipei}=require('./dates');
async function counts(db,id){return Number((await db.query('SELECT count(*)::int n FROM delivery_checkins WHERE trip_id=$1',[id])).rows[0].n);}
function heading(t){return `${t.task_code||'D'+String(t.id).padStart(6,'0')} ${t.task_name||'門店配送'}`;}
function format(t,stops,n,max=Infinity){
 const header=`【蝦皮店到店 ${heading(t)}】\n${t.service_date} ${t.departure_time}｜${t.warehouse_name}\n${t.warehouse_address||'取貨倉地址待調度確認'}\n狀態：${t.status}\n需求 ${t.required_checkins}／已報到 ${n}／尚缺 ${Math.max(0,t.required_checkins-n)}\n`;
 const footer=`\n報到：車趟報到 ${t.task_code}\n查詢：車趟狀態 ${t.task_code}\n同一LINE帳號每個車趟僅計一次。\n異常：車趟異常 ${t.task_code} 延誤 說明內容`;
 let body='';for(const s of stops){const line=`${s.stop_no}. ${s.store_code} ${s.store_name}｜${s.city}${s.district} ${s.address}\n`;if(header.length+body.length+line.length+footer.length+50>max){body+='其餘停靠站請於平台查看或複製完整任務文字。\n';break;}body+=line;}
 return header+body+footer;
}
async function handle(db,text,fleet,userId,eventId){
 const query=text.match(/^車趟狀態\s+([A-Za-z0-9_-]{1,40})$/);if(query){const t=(await db.query('SELECT t.*,w.name AS warehouse_name FROM delivery_trips t JOIN delivery_warehouses w ON w.id=t.warehouse_id WHERE upper(t.task_code)=$1 AND t.fleet_id=$2',[query[1].toUpperCase(),fleet.id])).rows[0];if(!t)return '找不到此車隊的車趟編號。';const stops=(await db.query('SELECT * FROM delivery_trip_stops WHERE trip_id=$1 ORDER BY stop_no',[t.id])).rows;return format(t,stops,await counts(db,t.id),4200);}
 const incident=text.match(/^車趟異常\s+([A-Za-z0-9_-]{1,40})\s+(延誤|車輛異常|貨損|事故|其他)\s+([\s\S]{1,1000})$/);
 if(incident){if(!incident[3].trim())return '請填寫異常說明。';const t=(await db.query('SELECT * FROM delivery_trips WHERE upper(task_code)=$1 AND fleet_id=$2 FOR UPDATE',[incident[1].toUpperCase(),fleet.id])).rows[0];if(!t||t.status==='已取消')return '找不到此車隊有效車趟。';const actor={username:'LINE車隊:'+fleet.id,role:'fleet'};const i=await require('./fleetOperations').addIncident(db,{...t,delivery:true},incident[2],incident[3].trim(),actor,eventId);return `異常 I${String(i.id).padStart(6,'0')} 已建立，請等待調度處理。`;}
 const m=text.match(/^車趟報到\s+([A-Za-z0-9_-]{1,40})$/);if(!m)return null;
 const t=(await db.query('SELECT * FROM delivery_trips WHERE upper(task_code)=$1 AND fleet_id=$2 FOR UPDATE',[m[1].toUpperCase(),fleet.id])).rows[0];
 if(!t)return '找不到此車隊的車趟編號。';
 if(t.service_date!==todayInTaipei()||['已取消','已完成'].includes(t.status))return '僅可報到今日尚未結束的車趟。';
 const hash=crypto.createHash('sha256').update(userId).digest('hex');
 const prior=await db.query('SELECT 1 FROM delivery_checkins WHERE trip_id=$1 AND reporter_hash=$2',[t.id,hash]);
 let n=await counts(db,t.id);
 if(prior.rowCount)return `${heading(t)} 已報到，未重複計數。已報到 ${n}／尚缺 ${Math.max(0,t.required_checkins-n)}`;
 if(n>=t.required_checkins)return `${heading(t)} 報到名額已滿，請聯絡調度。`;
 await db.query('INSERT INTO delivery_checkins(trip_id,reporter_hash,event_id) VALUES($1,$2,$3)',[t.id,hash,eventId]);n++;
 await audit(db,{username:'LINE車隊:'+fleet.id,role:'fleet'},'車趟報到','蝦皮門店車趟',t.id,`已報到${n}，尚缺${t.required_checkins-n}`);
 return `${heading(t)} 報到成功。需求 ${t.required_checkins}／已報到 ${n}／尚缺 ${t.required_checkins-n}`;
}
module.exports={counts,heading,format,handle};
