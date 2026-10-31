const crypto = require('node:crypto');
const { pool } = require('./db');
const { transaction, audit } = require('./transaction');
const { replyMessage } = require('./line');
const { todayInTaipei } = require('./dates');
const {handleFleetGroupEvent}=require('./fleetOperations');
const HELP = '【可用指令】\n綁定 管理員提供的一次性代碼\n我的任務／待派車／已完成／統計\n到站 訂單編號\n完成 訂單編號或完整櫃號\n異常 訂單編號 說明\n事故 訂單編號 說明\n請在私人對話操作；只可查詢及回報自己的任務。';
const codeHash = code => crypto.createHash('sha256').update(code).digest('hex');
function eventId(event) {
  return event.webhookEventId || crypto.createHash('sha256').update(JSON.stringify({
    type:event.type, source:event.source, message:event.message, timestamp:event.timestamp, replyToken:event.replyToken,
  })).digest('hex');
}
async function handleEvent(db, event, id) {
  await require('./lineGroups').observeGroup(db,event);
  if (event.type === 'join') return '已加入 Wayan。車隊群組請向管理員取得一次性代碼，在群組輸入「車隊群組綁定 代碼」。司機本人請私訊機器人綁定。';
  if (event.type !== 'message' || event.message?.type !== 'text') return null;
  const fleetReply=await handleFleetGroupEvent(db,event,id);
  if(fleetReply!==null) return fleetReply;
  if (event.source?.type !== 'user' || !event.source.userId) return '為保護派車資料，請私訊 Wayan Bot 操作。';
  const text = String(event.message.text || '').trim();
  const userId = event.source.userId;
  if (/^(說明|help|指令)$/i.test(text)) return HELP;
  const bind = text.match(/^綁定\s+([A-Za-z0-9_-]{22})$/);
  if (bind) {
    const code = (await db.query('SELECT * FROM line_binding_codes WHERE code_hash=$1 AND expires_at>NOW() FOR UPDATE', [codeHash(bind[1])])).rows[0];
    if (!code) return '綁定碼無效或已過期，請向管理員申請新的代碼。';
    await db.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE', [code.driver_id]);
    const existing = await db.query('SELECT 1 FROM line_driver_bindings WHERE line_user_id=$1 OR driver_id=$2', [userId,code.driver_id]);
    if (existing.rows.length) return '帳號或司機已綁定，請由管理員先解除舊綁定。';
    await db.query('INSERT INTO line_driver_bindings(line_user_id,driver_id) VALUES($1,$2)', [userId,code.driver_id]);
    await db.query('DELETE FROM line_binding_codes WHERE driver_id=$1', [code.driver_id]);
    await audit(db,{username:`LINE:${code.driver_id}`,role:'driver'},'綁定','LINE',code.driver_id,'一次性代碼驗證成功');
    return '綁定成功。輸入「我的任務」查看自己的任務。';
  }
  const binding = (await db.query('SELECT driver_id FROM line_driver_bindings WHERE line_user_id=$1 FOR SHARE', [userId])).rows[0];
  if (!binding) return '尚未綁定司機，無法讀取派車資料。請向管理員取得一次性綁定碼，再輸入「綁定 代碼」。';
  const driverId = binding.driver_id;
  const actor = {username:`LINE:${driverId}`,role:'driver'};
  const today = todayInTaipei();
  if (/^(我的任務|任務|待派車|今日待派車|已完成|今日已完成|統計|今日統計)$/.test(text)) {
    const all = (await db.query('SELECT * FROM orders WHERE driver_id=$1 ORDER BY time,id', [driverId])).rows;
    if (/統計$/.test(text)) {
      const todays = all.filter(o => o.time.startsWith(today));
      return `【今日統計】${today}\n我的今日任務：${todays.length}\n已完成：${todays.filter(o=>o.status==='已完成').length}\n執行中：${todays.filter(o=>['已派車','執行中'].includes(o.status)).length}`;
    }
    const done = /已完成$/.test(text);
    const list = all.filter(o=>done ? o.status==='已完成' && o.time.startsWith(today) : ['已派車','執行中'].includes(o.status));
    return `【${done?'今日已完成':'我的任務'}】\n` + (list.slice(0,25).map(o=>`${o.id}｜${o.container||'待補櫃號'}｜${o.from_location}→${o.to_location}｜${o.time}｜${o.status}`).join('\n') || '目前沒有任務。');
  }
  const command = text.match(/^(到站|完成|異常|事故)\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (!command) return HELP;
  const [,kind,identifier,detail] = command;
  if (['異常','事故'].includes(kind) && (!detail?.trim() || detail.trim().length>500)) return '請提供 1～500 字的說明，例如「異常 訂單編號 輪胎破損」。';
  await db.query('SELECT pg_advisory_xact_lock(870032)');
  const matches = (await db.query(`SELECT * FROM orders WHERE driver_id=$1 AND (id=$2 OR UPPER(container)=UPPER($2))
    AND status IN ('已派車','執行中','已完成') ORDER BY time DESC FOR UPDATE`, [driverId,identifier])).rows;
  if (matches.length!==1) return '找不到唯一可回報的本人任務，請使用「我的任務」列出的訂單編號。';
  const order = matches[0];
  if (order.status==='已完成') return '此任務已完成，不會重複異動。';
  if (kind==='到站' || kind==='完成') {
    await db.query('INSERT INTO order_reports(event_id,order_id,driver_id,kind) VALUES($1,$2,$3,$4)',[id,order.id,driverId,kind]);
    await db.query('UPDATE orders SET status=$1 WHERE id=$2',[kind==='完成'?'已完成':'執行中',order.id]);
    if (kind==='完成') {
      await db.query(`UPDATE drivers SET status='可派車' WHERE id=$1 AND status='執行中'
        AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))`,[driverId]);
      await db.query(`UPDATE vehicles SET status='可用' WHERE id=$1 AND status='執行中'
        AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))`,[order.vehicle_id]);
    }
    await audit(db,actor,kind,'訂單',order.id,'LINE 本人任務回報');
    return `已將 ${order.id} 標記為${kind==='完成'?'完成':'到站'}，管理端會同步更新。`;
  }
  const incidentKind = kind==='異常'?'車輛異常':'事故';
  await db.query('INSERT INTO operational_incidents(event_id,order_id,driver_id,vehicle_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6)',[id,order.id,driverId,order.vehicle_id,incidentKind,detail.trim()]);
  if (order.vehicle_id) await db.query("UPDATE vehicles SET status='停派' WHERE id=$1",[order.vehicle_id]);
  await audit(db,actor,incidentKind,'異常回報',order.id,detail.trim());
  return `${incidentKind}已登記，車輛已停派，管理端已收到待處理通知。若有人受傷或有立即危險，請先聯絡當地緊急服務。`;
}
async function processEvent(id) {
  try {
    const result = await transaction(pool,async db=>{
      const row=(await db.query('SELECT * FROM line_events WHERE event_id=$1 FOR UPDATE',[id])).rows[0];
      if (!row || row.status==='processed') return null;
      const reply=await handleEvent(db,row.payload,id);
      const payload=structuredClone(row.payload);
      if (/^\s*(?:綁定|車隊群組綁定)\s+/.test(payload.message?.text || '')) payload.message.text='[綁定碼已隱藏]';
      await db.query(`UPDATE line_events SET status='processed',attempts=attempts+1,processed_at=NOW(),reply_text=$2,
        payload=$3,error_code=NULL,delivery_status=$4 WHERE event_id=$1`,[id,reply,payload,reply && row.payload.replyToken?'pending':'skipped']);
      return {reply,token:row.payload.replyToken};
    });
    if (result?.reply && result.token) await deliverReply(id,result.token,result.reply);
    return true;
  } catch {
    await pool.query("UPDATE line_events SET status='failed',attempts=attempts+1,error_code='PROCESSING_FAILED' WHERE event_id=$1 AND status<>'processed'",[id]);
    return false;
  }
}
async function deliverReply(id,token,text) {
  try {
    await replyMessage(token,text);
    await pool.query("UPDATE line_events SET delivery_status='sent',error_code=NULL WHERE event_id=$1",[id]);
  } catch {
    await pool.query("UPDATE line_events SET delivery_status='failed',error_code='REPLY_FAILED' WHERE event_id=$1",[id]);
  }
}
async function receiveEvents(events) {
  for (const event of events) {
    const id=eventId(event);
    await pool.query('INSERT INTO line_events(event_id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,event]);
    if (!await processEvent(id)) throw new Error('LINE_EVENT_FAILED');
  }
}
module.exports={codeHash,eventId,receiveEvents,processEvent};
