const crypto=require('node:crypto');
const {audit}=require('./transaction');
const {todayInTaipei}=require('./dates');
async function counts(db,id){return Number((await db.query('SELECT count(*)::int n FROM delivery_checkins WHERE trip_id=$1',[id])).rows[0].n);}
function heading(t){return `${t.checkin_code||t.task_code||'D'+String(t.id).padStart(6,'0')} ${t.task_name||'門店配送'}`;}
function format(t,stops,n,max=Infinity){
 const header=`${(t.is_simulated||String(t.note||'').startsWith('[模擬]'))?'【模擬資料，不可實際派送】\n':''}【蝦皮店到店 ${heading(t)}】\n${t.service_date} ${t.departure_time}｜${t.warehouse_name}\n${t.warehouse_address||'取貨倉地址待調度確認'}\n狀態：${t.status}\n需求 ${t.required_checkins}／已報到 ${n}／尚缺 ${Math.max(0,t.required_checkins-n)}\n`;
 const footer=`\n報到：車趟報到 ${t.checkin_code||t.task_code}\n查詢：車趟狀態 ${t.checkin_code||t.task_code}\n同一LINE帳號每個車趟僅計一次。\n異常：車趟異常 ${t.checkin_code||t.task_code} 延誤 說明內容`;
 let body='';for(const s of stops){const line=`${s.stop_no}. ${s.store_code} ${s.store_name}｜${s.city}${s.district} ${s.address}\n`;if(header.length+body.length+line.length+footer.length+50>max){body+='其餘停靠站請於平台查看或複製完整任務文字。\n';break;}body+=line;}
 return header+body+footer;
}
async function handle(db,text,fleet,userId,eventId){
 text=String(text||'').normalize('NFKC').trim();const aliases=require('./deliveryAliases');
 const query=text.match(/^車趟狀態\s*([\p{Script=Han}A-Za-z0-9_-]{1,40})$/u);if(query){const t=await aliases.resolve(db,query[1],fleet.id);if(!t)return '找不到此車隊今日的報到代號或車趟編號。';const stops=(await db.query('SELECT * FROM delivery_trip_stops WHERE trip_id=$1 ORDER BY stop_no',[t.id])).rows;return format(t,stops,await counts(db,t.id),4200)+await aliases.totals(db,t);}
 const incident=text.match(/^車趟異常\s+([\p{Script=Han}A-Za-z0-9_-]{1,40})\s+(延誤|車輛異常|貨損|事故|其他)\s+([\s\S]{1,1000})$/u);
 if(incident){if(!incident[3].trim())return '請填寫異常說明。';const t=await aliases.resolve(db,incident[1],fleet.id,true);if(!t||t.status==='已取消')return '找不到此車隊有效車趟。';if(t.is_simulated)return '此為模擬車趟，已阻擋異常寫入營運表單；一般異常請用實際任務回報。';const i=await require('./fleetOperations').addIncident(db,{...t,delivery:true},incident[2],incident[3].trim(),{username:'LINE車隊:'+fleet.id,role:'fleet'},eventId);return `異常 I${String(i.id).padStart(6,'0')} 已建立，請等待調度處理。`;}
 const m=text.match(/^(?:車趟報到|報到)\s*([\p{Script=Han}A-Za-z0-9_-]{1,40})$/u),bare=!m&&/^[\p{Script=Han}A-Za-z_-]+\d+$/u.test(text)?text:null;
 if(!m&&!bare)return null;const t=await aliases.resolve(db,m?m[1]:bare,fleet.id,true);
 if(!t)return bare?null:'找不到此車隊今日的報到代號或車趟編號。';
 if(t.service_date!==todayInTaipei()||['已取消','已完成'].includes(t.status))return '僅可報到今日尚未結束的車趟。';
 if(bare&&!t.checkin_code)return null;
 const hash=crypto.createHash('sha256').update(userId).digest('hex'),prior=await db.query('SELECT 1 FROM delivery_checkins WHERE trip_id=$1 AND reporter_hash=$2',[t.id,hash]);let n=await counts(db,t.id);
 if(prior.rowCount)return `${heading(t)} 已報到，未重複計數。已報到 ${n}／尚缺 ${Math.max(0,t.required_checkins-n)}`+await aliases.totals(db,t);
 if(n>=t.required_checkins)return `${heading(t)} 報到名額已滿，請聯絡調度。`+await aliases.totals(db,t);
 await db.query('INSERT INTO delivery_checkins(trip_id,reporter_hash,event_id) VALUES($1,$2,$3)',[t.id,hash,eventId]);n++;
 await audit(db,{username:'LINE車隊:'+fleet.id,role:'fleet'},'車趟報到','蝦皮門店車趟',t.id,`已報到${n}，尚缺${t.required_checkins-n}`);
 return `${t.is_simulated?'【模擬報到】':''}${heading(t)} 報到成功。需求 ${t.required_checkins}／已報到 ${n}／尚缺 ${t.required_checkins-n}`+await aliases.totals(db,t);
}
module.exports={counts,heading,format,handle};
