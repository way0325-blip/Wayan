const crypto=require('node:crypto');
const GUIDE='【異常回報】\n請在10分鐘內傳送下一則文字作為異常內容（1～1000字）。\n例如：延誤 大園倉等候裝貨超過30分鐘\n可用類型：延誤、車輛異常、貨損、事故、其他；直接輸入說明則列為其他。\n也可一次傳送：異常回報 延誤 說明內容\n取消：取消回報\n請勿傳送密碼或Token。';
const business=/^(說明|help|指令|門店車趟|車隊任務|任務|蝦皮任務|蝦皮報到|蝦皮承接|蝦皮拒絕|承接|拒絕|到站|完成|異常|延誤|貨損|事故|車輛異常|車趟報到|車趟狀態|車趟異常|車隊群組綁定)(?:\s|$)/i;
async function handle(db,event,eventId,fleet){
 const text=String(event.message.text||'').trim(),group=event.source.groupId;
 const hash=crypto.createHash('sha256').update(event.source.userId).digest('hex');
 const params=[group,hash,fleet.id];
 if(text==='異常回報'){
  await db.query(`INSERT INTO line_incident_sessions(group_id,reporter_hash,fleet_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes') ON CONFLICT(group_id,reporter_hash) DO UPDATE SET fleet_id=EXCLUDED.fleet_id,expires_at=EXCLUDED.expires_at`,params);
  return GUIDE;
 }
 if(text==='取消回報'){await db.query('DELETE FROM line_incident_sessions WHERE group_id=$1 AND reporter_hash=$2 AND fleet_id=$3',params);return '已取消異常填報，未建立新案件。';}
 const progress=text.match(/^異常進度\s+I0*([1-9]\d{0,14})$/i);
 if(progress){const i=(await db.query(`SELECT i.id,i.status,j.status AS sync_status,j.error_code FROM fleet_incidents i LEFT JOIN fleet_delivery_jobs j ON j.job_key='sheet:incidents:'||i.id WHERE i.id=$1 AND i.fleet_id=$2`,[progress[1],fleet.id])).rows[0];if(!i)return '找不到本車隊的異常案件。';const status=i.sync_status==='sent'?'已同步Google Sheets':i.sync_status==='blocked'?'等待管理員完成雲端連線設定':i.sync_status==='failed'?'同步失敗，等待重試或管理員處理':'等待同步Google Sheets';return `I${String(i.id).padStart(6,'0')}｜${i.status}\n雲端狀態：${status}`;}
 const oneShot=text.match(/^異常回報\s+([\s\S]*)$/);
 const session=(await db.query('SELECT expires_at>NOW() AS active FROM line_incident_sessions WHERE group_id=$1 AND reporter_hash=$2 AND fleet_id=$3',params)).rows[0];
 if(!oneShot){
  if(!session)return null;
  if(business.test(text)||/^異常進度(?:\s|$)/.test(text)){
   // A category plus description is part of the form, but legacy task commands retain priority.
   if(!/^(延誤|車輛異常|貨損|事故|其他)\s+/.test(text)||/^(延誤|車輛異常|貨損|事故)\s+T?\d+(?:\s|$)/i.test(text))return null;
  }
  if(!session.active){await db.query('DELETE FROM line_incident_sessions WHERE group_id=$1 AND reporter_hash=$2 AND fleet_id=$3',params);return '異常填報已逾10分鐘，未建立案件。請重新輸入「異常回報」。';}
 }
 const content=(oneShot?oneShot[1]:text).trim();
 if(/^(延誤|車輛異常|貨損|事故|其他)$/.test(content))return '請在異常類型後補上說明；尚未建立案件。';
 if(!content||content.length>1000)return '請提供1～1000字異常內容；尚未建立案件。';
 const typed=content.match(/^(延誤|車輛異常|貨損|事故|其他)\s+([\s\S]+)$/);
 const kind=typed?typed[1]:'其他',description=(typed?typed[2]:content).trim();
 if(!description)return '請補上異常說明；尚未建立案件。';
 const i=await require('./fleetOperations').addIncident(db,{fleet_id:fleet.id,general:true},kind,description,{username:'LINE車隊:'+fleet.id+':'+hash.slice(0,8),role:'fleet'},eventId);
 await db.query('DELETE FROM line_incident_sessions WHERE group_id=$1 AND reporter_hash=$2 AND fleet_id=$3',params);
 const number='I'+String(i.id).padStart(6,'0');
 return `【異常已受理】${number}\n車隊：${fleet.name}\n類型：${kind}\n內容：${description}\n案件已建立，Google Sheets已排入同步，尚未確認雲端寫入完成。\n查詢：異常進度 ${number}`;
}
module.exports={handle,GUIDE};
