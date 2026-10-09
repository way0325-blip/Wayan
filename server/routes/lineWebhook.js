const express = require("express");
const { pool } = require("../db");
const {
  isConfigured,
  verifySignature,
  replyMessage,
  lookupDailyIndex,
  getProfile,
} = require("../line");
const { todayInTaipei } = require("../dates");
const { findOrder, findActiveOrderByContainerFragment, completeOrder } = require("../orderService");

const router = express.Router();

const HELP_TEXT = [
  "【可用指令】",
  "・待派車 — 列出目前待派車的訂單",
  "・已完成 — 列出今天已完成的訂單",
  "・統計 — 今日訂單統計",
  "・回報完成:直接回覆「N號完成」(N 是明細上的編號),或「完成 貨櫃編號」",
  "・說明 — 顯示這份說明",
].join("\n");

async function logLineEvent(sourceId, sourceType, text) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (username, role, action, entity, entity_id, detail)
       VALUES ($1, 'line', 'LINE訊息', 'LINE', $2, $3)`,
      [sourceType, sourceId, (text || "").slice(0, 300)]
    );
  } catch (e) { console.error("記錄 LINE 事件失敗:", e.message); }
}

function sourceIdOf(source) {
  return source.type === "group" ? source.groupId : source.type === "room" ? source.roomId : source.userId;
}

async function listPendingText() {
  const { rows } = await pool.query("SELECT * FROM orders WHERE status = '待派車' ORDER BY time");
  if (!rows.length) return "目前沒有待派車的訂單。";
  return "【待派車】共 " + rows.length + " 筆\n" + rows
    .map((o, i) => `${i + 1}. ${o.container}｜${o.from}→${o.to}｜${o.time.replace("T", " ")}`)
    .join("\n");
}

async function listCompletedTodayText() {
  const today = todayInTaipei();
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE status = '已完成' AND time LIKE $1 ORDER BY time",
    [today + "%"]
  );
  if (!rows.length) return "今天目前還沒有已完成的訂單。";
  return "【今日已完成】共 " + rows.length + " 筆\n" + rows
    .map((o, i) => `${i + 1}. ${o.container}｜${o.from}→${o.to}`)
    .join("\n");
}

async function statsText() {
  const today = todayInTaipei();
  const { rows } = await pool.query("SELECT status, time FROM orders");
  const todays = rows.filter((o) => String(o.time).startsWith(today));
  const count = (list, st) => list.filter((o) => o.status === st).length;
  return [
    `【今日統計】${today}`,
    `今日訂單:${todays.length}`,
    `待派車:${count(rows, "待派車")}`,
    `已派車/執行中:${count(rows, "已派車") + count(rows, "執行中")}`,
    `今日已完成:${count(todays, "已完成")}`,
  ].join("\n");
}

async function handleComplete(order, actor, replyToken) {
  const { order: updated, error, alreadyDone } = await completeOrder(order.id, actor);
  if (error) return replyMessage(replyToken, "找不到這筆訂單。");
  if (alreadyDone) return replyMessage(replyToken, `${updated.container} 先前已經是完成狀態囉。`);
  await replyMessage(
    replyToken,
    `✅ 已將 ${updated.container}(${updated.from_location}→${updated.to_location})標記為完成,並釋放司機與車輛。`
  );
}

async function handleText(event) {
  const text = (event.message.text || "").trim();
  const sourceId = sourceIdOf(event.source);
  await logLineEvent(sourceId, event.source.type, text);

  if (/^(今日)?待派車$/.test(text)) return replyMessage(event.replyToken, await listPendingText());
  if (/^(今日)?已完成$/.test(text)) return replyMessage(event.replyToken, await listCompletedTodayText());
  if (/^(今日)?統計$/.test(text)) return replyMessage(event.replyToken, await statsText());
  if (/^(說明|help|指令)$/i.test(text)) return replyMessage(event.replyToken, HELP_TEXT);

  const bySeq = text.match(/^(\d{1,3})\s*[號号]?\s*(?:已)?完成$/);
  if (bySeq) {
    const orderId = await lookupDailyIndex(sourceId, Number(bySeq[1]));
    if (!orderId) {
      return replyMessage(event.replyToken, "查不到這個編號,可能還沒發送過明細,或編號已經過期。可以改用「完成 貨櫃編號」回報。");
    }
    const order = await findOrder(orderId);
    if (!order) return replyMessage(event.replyToken, "找不到這個編號對應的訂單。");
    const profile = await getProfile(event.source);
    return handleComplete(order, { username: "LINE:" + (profile?.displayName || sourceId.slice(-6)), role: "line" }, event.replyToken);
  }

  const byContainer = text.match(/^(?:已)?完成\s*[:：]?\s*(\S+)$/);
  if (byContainer) {
    const { order, matches } = await findActiveOrderByContainerFragment(byContainer[1]);
    if (order) {
      const profile = await getProfile(event.source);
      return handleComplete(order, { username: "LINE:" + (profile?.displayName || sourceId.slice(-6)), role: "line" }, event.replyToken);
    }
    if (matches.length > 1) {
      const list = matches.slice(0, 5).map((m) => `・${m.container}(${m.ship}）`).join("\n");
      return replyMessage(event.replyToken, `符合「${byContainer[1]}」的訂單有多筆,請打完整貨櫃編號:\n${list}`);
    }
    return replyMessage(event.replyToken, `找不到貨櫃編號含「${byContainer[1]}」且狀態為已派車/執行中的訂單。`);
  }
}

router.post("/webhook", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
  // 一律先回 200,避免 LINE 因逾時重送;實際處理放在背景執行
  res.status(200).end();

  if (!isConfigured()) return;

  const signature = req.headers["x-line-signature"];
  if (!verifySignature(req.body, signature)) {
    console.error("LINE webhook 簽章驗證失敗");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return;
  }

  for (const event of payload.events || []) {
    try {
      if (event.type === "message" && event.message?.type === "text") {
        await handleText(event);
      } else if (event.type === "join") {
        const sourceId = sourceIdOf(event.source);
        await logLineEvent(sourceId, event.source.type, "(機器人被加入)");
        await replyMessage(
          event.replyToken,
          `👋 已加入。這個對話的 ID 是:\n${sourceId}\n\n請把這組 ID 貼到後台「⚙️ 後台管理 → 網站內容設定 → LINE 群組」才能接收推播。\n\n${HELP_TEXT}`
        );
      }
    } catch (err) {
      console.error("處理 LINE 事件失敗:", err);
    }
  }
});

module.exports = router;
