const test = require("node:test");
const { mock } = test;
const assert = require("node:assert");
const crypto = require("node:crypto");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";
process.env.LINE_CHANNEL_SECRET = "line-test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "dummy-token";
process.env.CRON_SECRET = "cron-test-secret";

const { pool, initDb } = require("../db");
const line = require("../line");

// 攔截所有對 LINE API 的呼叫,記錄下來但不真的打出去
const sentCalls = [];
const realFetch = global.fetch;
function installFetchStub() {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://api.line.me")) {
      sentCalls.push({ url: u, body: opts?.body ? JSON.parse(opts.body) : null });
      if (u.includes("/profile/") || u.includes("/member/")) {
        return { ok: true, json: async () => ({ displayName: "測試司機" }) };
      }
      return { ok: true, text: async () => "" };
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() { global.fetch = realFetch; }

let app, server, base;

test.before(async () => {
  await pool.query("DROP TABLE IF EXISTS audit_logs, settings, line_daily_index, orders, drivers, vehicles, users CASCADE");
  await initDb();
  // 種子資料的證照/保養日期是寫死的,到期後(例如 2026-11-18)派車檢查會讓測試變紅,
  // 跟程式有沒有問題無關。測試開始前把會被用來派車的種子資料拉到很遠的未來。
  await pool.query("UPDATE drivers SET license = '2099-12-31' WHERE id IN ('D001', 'D002')");
  await pool.query("UPDATE vehicles SET maintenance = '2099-12-31' WHERE id IN ('V001', 'V002')");
  installFetchStub();
  app = require("../index");
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  restoreFetch();
  server.close();
  await pool.end();
});

async function call(method, path, headers, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function sign(body) {
  return crypto.createHmac("SHA256", process.env.LINE_CHANNEL_SECRET).update(body).digest("base64");
}

async function waitFor(predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

// webhook 立刻回 200,實際處理是背景非同步進行的;用輪詢取代固定 sleep,
// 避免在較慢的 CI 環境下因為時間沒等夠而變成 flaky test。
async function sendWebhook(events, opts = {}) {
  const body = JSON.stringify({ events });
  sentCalls.length = 0;
  const res = await fetch(`${base}/api/line/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
    body,
  });
  if (opts.expectNoCall) {
    await new Promise((r) => setTimeout(r, 500));
  } else {
    await waitFor(() => sentCalls.length > 0);
  }
  return res.status;
}

let adminAuth;
test("signature verification: correct signature accepted, wrong signature rejected", async () => {
  const body = JSON.stringify({ events: [] });
  const ok = await fetch(`${base}/api/line/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
    body,
  });
  assert.strictEqual(ok.status, 200);

  await fetch(`${base}/api/line/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": "bogus" },
    body: JSON.stringify({ events: [{ type: "message", message: { type: "text", text: "統計" }, replyToken: "rt", source: { type: "user", userId: "U1" } }] }),
  });
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(sentCalls.length, 0, "簽章錯誤時不應呼叫 LINE API");
});

test("join event replies with the source id and logs it", async () => {
  await sendWebhook([{ type: "join", replyToken: "rt-join", source: { type: "group", groupId: "Gtest123" } }]);
  assert.strictEqual(sentCalls.length, 1);
  assert.ok(sentCalls[0].url.endsWith("/message/reply"));
  assert.ok(sentCalls[0].body.messages[0].text.includes("Gtest123"));

  const login = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "admin", password: "1234" });
  adminAuth = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };
  const logs = (await call("GET", "/api/audit-logs?entity=LINE", adminAuth)).data;
  assert.ok(logs.some((l) => l.detail.includes("機器人被加入")));
});

test("query commands reply with pending/stats text", async () => {
  await sendWebhook([{ type: "message", message: { type: "text", text: "待派車" }, replyToken: "rt1", source: { type: "user", userId: "U1" } }]);
  assert.match(sentCalls[0].body.messages[0].text, /待派車/);

  await sendWebhook([{ type: "message", message: { type: "text", text: "統計" }, replyToken: "rt2", source: { type: "user", userId: "U1" } }]);
  assert.match(sentCalls[0].body.messages[0].text, /今日統計/);

  await sendWebhook([{ type: "message", message: { type: "text", text: "說明" }, replyToken: "rt3", source: { type: "user", userId: "U1" } }]);
  assert.match(sentCalls[0].body.messages[0].text, /可用指令/);
});

test("LINE 「統計」「已完成」在台灣凌晨(UTC 還是前一天)仍以台灣日期計算", async () => {
  // 台灣 2026-10-09 01:30 = UTC 2026-10-08 17:30。舊版用 UTC 日期,這時會把「今天」算成 10/08。
  await pool.query(
    `INSERT INTO orders (id, ship, container, from_location, to_location, time, size, status, dispatch_type, carrier)
     VALUES ('O-TZ-1', 'TZ SHIP', 'TZCONT001', '高雄港', '台中', '2026-10-09T09:00', '20 呎', '已完成', 'CY', '陽明')`
  );

  const ask = async (text, token) => {
    const body = JSON.stringify({ events: [{ type: "message", message: { type: "text", text }, replyToken: token, source: { type: "user", userId: "Utz" } }] });
    sentCalls.length = 0;
    await fetch(`${base}/api/line/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
      body,
    });
    // 時鐘被凍結時 Date.now() 不會前進,所以這裡用「次數」而不是時間來限制等待
    for (let i = 0; i < 200 && !sentCalls.length; i++) await new Promise((r) => setTimeout(r, 25));
    return sentCalls[0]?.body.messages[0].text || "";
  };

  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-08T17:30:00Z") });
  let stats, done;
  try {
    stats = await ask("統計", "rt-tz-1");
    done = await ask("已完成", "rt-tz-2");
  } finally {
    mock.timers.reset();
  }
  assert.match(stats, /【今日統計】2026-10-09/);
  assert.match(done, /TZCONT001/, "預定 10/09 的訂單在台灣 10/09 凌晨應算作「今天」");
});

test("push-line requires LINE group configured, then pushes and enables N號完成 reporting", async () => {
  const orders = (await call("GET", "/api/orders", adminAuth)).data;
  const target = orders.find((o) => o.status === "已派車");
  assert.ok(target);

  const noGroup = await call("POST", "/api/orders/push-line", adminAuth, { orderIds: [target.id] });
  assert.strictEqual(noGroup.status, 400);
  assert.match(noGroup.data.error, /群組/);

  const setGroup = await call("PUT", "/api/settings", adminAuth, { lineGroupIds: ["Gtest123"] });
  assert.deepStrictEqual(setGroup.data.lineGroupIds, ["Gtest123"]);

  sentCalls.length = 0;
  const pushed = await call("POST", "/api/orders/push-line", adminAuth, { orderIds: [target.id] });
  assert.strictEqual(pushed.status, 200);
  assert.deepStrictEqual(pushed.data.groups, ["Gtest123"]);
  assert.ok(sentCalls.some((c) => c.url.endsWith("/message/push") && c.body.to === "Gtest123"));

  // 群組現在應該可以用「1號完成」回報這筆(因為剛才推送只有這一筆,編號一定是 1)
  await sendWebhook([{ type: "message", message: { type: "text", text: "1號完成" }, replyToken: "rt4", source: { type: "group", groupId: "Gtest123" } }]);
  assert.match(sentCalls.at(-1).body.messages[0].text, /已將.*標記為完成/);

  const after = (await call("GET", "/api/orders", adminAuth)).data.find((o) => o.id === target.id);
  assert.strictEqual(after.status, "已完成");

  const logs = (await call("GET", "/api/audit-logs?entity=訂單", adminAuth)).data;
  assert.ok(logs.some((l) => l.action === "完成" && l.username.startsWith("LINE:")));
});

test("report by container fragment: exact single match completes, ambiguous match lists options", async () => {
  const drivers = (await call("GET", "/api/drivers", adminAuth)).data;
  const vehicles = (await call("GET", "/api/vehicles", adminAuth)).data;
  const dispatchable = (await call("GET", "/api/orders", adminAuth)).data.find((o) => o.status === "待派車");
  assert.ok(dispatchable);

  const dispatch = await call("PATCH", `/api/orders/${dispatchable.id}/dispatch`, adminAuth, {
    driverId: drivers.find((d) => d.status === "可派車").id,
    vehicleId: vehicles.find((v) => v.status === "可用").id,
  });
  assert.strictEqual(dispatch.status, 200);

  sentCalls.length = 0;
  await sendWebhook([{ type: "message", message: { type: "text", text: `完成 ${dispatchable.container}` }, replyToken: "rt5", source: { type: "group", groupId: "Gtest123" } }]);
  assert.match(sentCalls.at(-1).body.messages[0].text, /已將.*標記為完成/);

  sentCalls.length = 0;
  await sendWebhook([{ type: "message", message: { type: "text", text: "完成 NOPE99999" }, replyToken: "rt6", source: { type: "group", groupId: "Gtest123" } }]);
  assert.match(sentCalls.at(-1).body.messages[0].text, /找不到貨櫃編號/);
});

test("cron endpoints require the shared secret and push a report", async () => {
  const unauth = await call("POST", "/api/line/cron/daily", { "Content-Type": "application/json" });
  assert.strictEqual(unauth.status, 401);

  sentCalls.length = 0;
  const ok = await call("POST", "/api/line/cron/daily", { "Content-Type": "application/json", "x-cron-secret": "cron-test-secret" });
  assert.strictEqual(ok.status, 200);
  assert.ok(sentCalls.some((c) => c.url.endsWith("/message/push")));

  sentCalls.length = 0;
  const weekly = await call("POST", "/api/line/cron/weekly", { "Content-Type": "application/json", "x-cron-secret": "cron-test-secret" });
  assert.strictEqual(weekly.status, 200);
  assert.ok(sentCalls.some((c) => c.body.messages[0].text.includes("本週統計")));
});
