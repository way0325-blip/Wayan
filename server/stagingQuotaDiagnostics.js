const crypto=require('node:crypto');
const {pool}=require('./db');
const digest=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex').slice(0,16);
async function record(id,db=pool,log=console.log){
 if(process.env.WAYAN_ENV!=='staging')return;
 const e=(await db.query('SELECT payload,status,delivery_status,reply_text FROM line_events WHERE event_id=$1',[id])).rows[0];if(!e)return;
 const match=String(e.payload?.message?.text||'').normalize('NFKC').trim().match(/^車趟報到\s+([NFW]-TEST-[A-F0-9]{8})$/);if(!match)return;
 const setting=(await db.query('SELECT value FROM settings WHERE key=$1',['quota-checkin:'+match[1]])).rows[0];if(!setting)return;
 let value;try{value=JSON.parse(setting.value);}catch{return;}
 const t=(await db.query('SELECT is_simulated,service_date,(SELECT count(*)::int FROM delivery_checkins WHERE trip_id=t.id) AS reported FROM delivery_trips t WHERE t.id=$1',[value.tripId])).rows[0];if(!t?.is_simulated||t.service_date!==value.date)return;
 log('STAGING_QUOTA_CHECKIN',JSON.stringify({taskCode:match[1],eventHash:digest(id),actorHash:digest(e.payload?.source?.userId),processing:e.status,reply:e.delivery_status,configured:require('./line').isConfigured(),replyTokenPresent:Boolean(e.payload?.replyToken),reported:t.reported,duplicate:String(e.reply_text||'').includes('未重複計數')}));
}
module.exports={record};
