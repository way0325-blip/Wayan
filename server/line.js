const crypto = require("node:crypto");
const { pool } = require("./db");
const { getSettings } = require("./settings");
const { buildDispatchText } = require("./lineFormat");

const API_BASE = "https://api.line.me/v2/bot";
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MAX_LEN = 4500; // LINE 單則訊息上限 5000 字,留一點緩衝

function isConfigured() {
  return Boolean(CHANNEL_SECRET && ACCESS_TOKEN);
}

// 驗證 LINE 傳來的 webhook 簽章,rawBody 必須是尚未被 JSON.parse 過的原始 Buffer/字串
function verifySignature(rawBody, signature) {
  if (!CHANNEL_SECRET || !signature) return false;
  const hash = crypto.createHmac("SHA256", CHANNEL_SECRET).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// 超過長度就切成多則,每則保留在同一個自然段落(空行)的邊界上,盡量不切斷一筆訂單
function chunkText(text) {
  if (text.length <= MAX_LEN) return [text];
  const blocks = text.split("\n\n");
  const chunks = [];
  let cur = "";
  for (const b of blocks) {
    const candidate = cur ? cur + "\n\n" + b : b;
    if (candidate.length > MAX_LEN && cur) {
      chunks.push(cur);
      cur = b;
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function callLineApi(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} 失敗(${res.status}):${detail.slice(0, 300)}`);
  }
}

async function replyMessage(replyToken, text) {
  if (!isConfigured()) return;
  const messages = chunkText(text).slice(0, 5).map((t) => ({ type: "text", text: t }));
  await callLineApi("/message/reply", { replyToken, messages });
}

async function pushMessage(to, text) {
  if (!isConfigured()) return;
  const chunks = chunkText(text);
  // LINE 一次最多 5 則訊息,超過的話分批呼叫
  for (let i = 0; i < chunks.length; i += 5) {
    const messages = chunks.slice(i, i + 5).map((t) => ({ type: "text", text: t }));
    await callLineApi("/message/push", { to, messages });
  }
}

async function getProfile(source) {
  try {
    const path =
      source.type === "group"
        ? `/group/${source.groupId}/member/${source.userId}`
        : `/profile/${source.userId}`;
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 記錄某個對話(群組或個人)最近一次發送的編號清單,供「N號完成」回報比對
async function recordDailyIndex(sourceId, numbering) {
  await pool.query("DELETE FROM line_daily_index WHERE source_id = $1", [sourceId]);
  for (const { seq, orderId } of numbering) {
    await pool.query(
      "INSERT INTO line_daily_index (source_id, seq, order_id) VALUES ($1, $2, $3)",
      [sourceId, seq, orderId]
    );
  }
}

async function lookupDailyIndex(sourceId, seq) {
  const { rows } = await pool.query(
    "SELECT order_id FROM line_daily_index WHERE source_id = $1 AND seq = $2",
    [sourceId, seq]
  );
  return rows[0]?.order_id || null;
}

// 把選定的訂單推送到後台設定好的所有 LINE 群組,並更新每個群組各自的編號對照
async function pushDispatchList(orders, drivers, vehicles, opts = {}) {
  if (!isConfigured()) return { error: "尚未設定 LINE 頻道(LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET)" };

  const { line_group_ids } = await getSettings();
  if (!line_group_ids.length) return { error: "尚未在後台設定 LINE 群組,請先取得群組 ID 並填入設定" };

  const { text, numbering } = buildDispatchText(orders, drivers, vehicles, opts);
  const sentTo = [];
  for (const groupId of line_group_ids) {
    await pushMessage(groupId, text);
    await recordDailyIndex(groupId, numbering);
    sentTo.push(groupId);
  }
  return { sentTo, text };
}

module.exports = {
  isConfigured,
  verifySignature,
  replyMessage,
  pushMessage,
  getProfile,
  recordDailyIndex,
  lookupDailyIndex,
  pushDispatchList,
};
