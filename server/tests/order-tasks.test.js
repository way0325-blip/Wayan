const test = require("node:test");
const assert = require("node:assert");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");
const { buildDispatchText } = require("../lineFormat");

let server, base, admin, ops;

async function call(method, path, headers, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, raw: text };
}
const api = (m, p, b, who = admin) => call(m, p, who, b);

const TASK = { shipCall: "152667", carrier: "愛媛", ship: "EHIME / 012", from: "高雄港", to: "台中倉庫", time: "2026-10-10T09:00", dispatchType: "船邊" };
const task = (extra = {}, who = admin) => api("POST", "/api/orders/task", { ...TASK, ...extra }, who);
const ordersOf = async (shipCall) => (await api("GET", "/api/orders")).data.filter((o) => o.shipCall === shipCall);

test.before(async () => {
  await pool.query("DROP TABLE IF EXISTS shopee_assignments, fleet_routes, partner_fleets, shopee_routes, attendance_records, dispatch_staff, vehicle_maintenance_items, audit_logs, settings, line_daily_index, orders, drivers, vehicles, users CASCADE");
  await initDb();
  const app = require("../index");
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "admin", password: "1234" });
  admin = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };
  await api("POST", "/api/users", { username: "task-ops", password: "pass1234", role: "dispatcher" });
  const l2 = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "task-ops", password: "pass1234" });
  ops = { Authorization: "Bearer " + l2.data.token, "Content-Type": "application/json" };
});
test.after(async () => { server.close(); await pool.end(); });

test("fresh database offers a 40HQ size, and the one-time migration adds it to an existing list exactly once", async () => {
  const fresh = (await api("GET", "/api/settings")).data.containerSizes;
  assert.ok(fresh.includes("40HQ"));

  // 模擬舊的線上資料庫:尺寸清單沒有 HQ,也還沒做過遷移
  await pool.query("UPDATE settings SET value = $1 WHERE key = 'container_sizes'", [JSON.stringify(["20 呎", "40 呎", "45 呎"])]);
  await pool.query("DELETE FROM settings WHERE key = 'migration_hq_size'");
  await initDb();
  assert.deepStrictEqual((await api("GET", "/api/settings")).data.containerSizes, ["20 呎", "40 呎", "45 呎", "40HQ"]);

  // 管理員之後自己拿掉 HQ,重啟時不可以又被加回來
  await api("PUT", "/api/settings", { containerSizes: ["20 呎", "40 呎"] });
  await initDb();
  assert.deepStrictEqual((await api("GET", "/api/settings")).data.containerSizes, ["20 呎", "40 呎"]);
  await api("PUT", "/api/settings", { containerSizes: ["20 呎", "40 呎", "40HQ", "45 呎"] });
});

test("task: creates one order per truck by size, with 船掛 / free-text 船商, no container yet; response has the counts", async () => {
  const r = await task({ qty20: 2, qty40: 3, qtyHQ: 1 });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  assert.strictEqual(r.data.created, 6);
  assert.deepStrictEqual(r.data.counts, { 20: 2, 40: 3, HQ: 1, total: 6 });

  const orders = await ordersOf("152667");
  assert.strictEqual(orders.length, 6);
  const bySize = {};
  for (const o of orders) bySize[o.size] = (bySize[o.size] || 0) + 1;
  assert.deepStrictEqual(bySize, { "20 呎": 2, "40 呎": 3, "40HQ": 1 });
  for (const o of orders) {
    assert.strictEqual(o.container, "", "櫃號之後再補");
    assert.strictEqual(o.status, "待派車");
    assert.strictEqual(o.carrier, "愛媛", "船商是自由輸入,不在後台清單內也行");
    assert.strictEqual(o.ship, "EHIME / 012");
    assert.strictEqual(o.dispatchType, "船邊");
    assert.strictEqual(o.time, "2026-10-10T09:00");
  }
  assert.strictEqual(new Set(orders.map((o) => o.id)).size, 6, "訂單編號不可重複");
});

test("task: blank counts mean 0, a ship name is optional when 船掛 is given, dispatcher may create, login required", async () => {
  const r = await task({ shipCall: "OPT-1", ship: "", qty20: "", qty40: 1 }, ops);
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  assert.deepStrictEqual(r.data.counts, { 20: 0, 40: 1, HQ: 0, total: 1 });
  assert.strictEqual(r.data.orders[0].ship, "船掛 OPT-1", "沒填船名時用船掛當列表上的船名");
  assert.strictEqual((await call("POST", "/api/orders/task", {}, { ...TASK, qty20: 1 })).status, 401);
});

test("task: validation is all-or-nothing — bad counts, no trucks, over the limit, missing fields, bad time", async () => {
  const before = (await api("GET", "/api/orders")).data.length;
  const bad = [
    [{ qty20: -1 }, "負數"],
    [{ qty20: 1.5 }, "小數"],
    [{ qty20: "abc" }, "非數字"],
    [{ qty20: true }, "布林"],
    [{ qty20: 201 }, "單一尺寸超過上限"],
    [{ qty20: 100, qty40: 100, qtyHQ: 1 }, "總數超過 200"],
    [{}, "全部是 0"],
    [{ qty20: 0, qty40: 0, qtyHQ: 0 }, "全部明確填 0"],
    [{ qty20: 1, carrier: "" }, "沒有船商"],
    [{ qty20: 1, carrier: "   " }, "船商只有空白"],
    [{ qty20: 1, carrier: "x".repeat(31) }, "船商太長"],
    [{ qty20: 1, ship: "", shipCall: "" }, "船名與船掛都沒填"],
    [{ qty20: 1, from: "" }, "沒有起點"],
    [{ qty20: 1, to: "" }, "沒有終點"],
    [{ qty20: 1, time: "不是時間" }, "時間格式錯"],
    [{ qty20: 1, time: "2026-10-10" }, "只有日期沒有時間"],
    [{ qty20: 1, dispatchType: "碼頭" }, "調派類型不合法"],
    [{ qty20: 1, shipCall: "x".repeat(31) }, "船掛太長"],
  ];
  for (const [extra, why] of bad) {
    const r = await task(extra);
    assert.strictEqual(r.status, 400, `應拒絕(${why}):${JSON.stringify(extra)} → ${r.status}`);
  }
  assert.strictEqual((await api("GET", "/api/orders")).data.length, before, "被拒絕的請求不能留下任何訂單");

  const edge = await task({ shipCall: "EDGE-200", qty20: 100, qty40: 50, qtyHQ: 50 });
  assert.strictEqual(edge.status, 201, "剛好 200 台可以");
  assert.strictEqual(edge.data.created, 200);
});

test("task orders go through the normal flow: edit container number, dispatch, complete", async () => {
  const r = await task({ shipCall: "FLOW-1", qty20: 1 });
  const id = r.data.orders[0].id;

  const edit = await api("PATCH", `/api/orders/${id}`, { container: "EMCU7654321", shipCall: "FLOW-1B", carrier: "天鵝湖" }, ops);
  assert.strictEqual(edit.status, 200);
  assert.strictEqual(edit.data.container, "EMCU7654321");
  assert.strictEqual(edit.data.shipCall, "FLOW-1B");
  assert.strictEqual(edit.data.carrier, "天鵝湖");

  await pool.query("UPDATE drivers SET license = '2099-12-31' WHERE id = 'D001'");
  await pool.query("UPDATE vehicles SET maintenance = '2099-12-31' WHERE id = 'V001'");
  const dispatched = await api("PATCH", `/api/orders/${id}/dispatch`, { driverId: "D001", vehicleId: "V001" });
  assert.strictEqual(dispatched.status, 200, JSON.stringify(dispatched.data));
  assert.strictEqual((await api("PATCH", `/api/orders/${id}/complete`)).data.status, "已完成");
});

test("editing keeps 船名 / 船商 non-empty, and a single order can still be created with 船掛 and free-text 船商", async () => {
  const r = await task({ shipCall: "EDIT-1", ship: "", qty20: 1 });
  const id = r.data.orders[0].id;
  assert.strictEqual((await api("PATCH", `/api/orders/${id}`, { carrier: "  " })).status, 400);
  assert.strictEqual((await api("PATCH", `/api/orders/${id}`, { shipCall: "", ship: "" })).status, 400, "船名與船掛不能同時被清空");
  const renamed = await api("PATCH", `/api/orders/${id}`, { ship: "NEW NAME / 1" });
  assert.strictEqual(renamed.data.ship, "NEW NAME / 1");

  const single = await api("POST", "/api/orders", { shipCall: "SINGLE-1", carrier: "任意船商", container: "ABCU1111111", from: "A", to: "B", time: "2026-10-10T10:00", size: "40HQ", dispatchType: "CY" });
  assert.strictEqual(single.status, 201, JSON.stringify(single.data));
  assert.strictEqual(single.data.ship, "船掛 SINGLE-1");
  assert.strictEqual(single.data.shipCall, "SINGLE-1");
  assert.strictEqual((await api("POST", "/api/orders", { carrier: "x", container: "ABCU2222222", from: "A", to: "B", time: "2026-10-10T10:00", size: "40HQ", dispatchType: "CY" })).status, 400, "單筆也要有船名或船掛");
});

test("summary: groups by 船掛 / 船商 / 船名, 40HQ is counted as HQ not 40, odd sizes go to 其他, totals add up", async () => {
  await pool.query("DELETE FROM orders");
  await task({ shipCall: "SUM-A", carrier: "愛媛", ship: "SHIP A", qty20: 2, qty40: 3, qtyHQ: 4 });
  await task({ shipCall: "SUM-B", carrier: "陽明", ship: "SHIP B", qty40: 1 });
  await task({ shipCall: "", carrier: "夏輝", ship: "NO CALL", qty20: 1 });
  await api("POST", "/api/orders", { shipCall: "SUM-A", ship: "SHIP A", carrier: "愛媛", container: "ODD00000001", from: "X", to: "Y", time: "2026-10-10T11:00", size: "45 呎", dispatchType: "CY" });

  const sum = (await api("GET", "/api/orders/task-summary")).data;
  const a = sum.groups.find((g) => g.shipCall === "SUM-A");
  assert.deepStrictEqual([a.n20, a.n40, a.nHQ, a.other, a.total], [2, 3, 4, 1, 10], "40HQ 不能算進 40;45 呎進其他");
  assert.strictEqual(a.carrier, "愛媛");
  assert.strictEqual(a.pending, 10);
  const b = sum.groups.find((g) => g.shipCall === "SUM-B");
  assert.deepStrictEqual([b.n20, b.n40, b.nHQ, b.total], [0, 1, 0, 1]);

  assert.strictEqual(sum.groups[sum.groups.length - 1].shipCall, "", "沒有船掛的排在最後");
  assert.deepStrictEqual(
    [sum.totals.n20, sum.totals.n40, sum.totals.nHQ, sum.totals.other, sum.totals.total],
    [3, 4, 4, 1, 12]
  );
  for (const g of sum.groups) assert.strictEqual(g.n20 + g.n40 + g.nHQ + g.other, g.total, "各尺寸加總要等於總計");

  // 派車進度會反映在剩餘待派車
  const orders = (await api("GET", "/api/orders")).data.filter((o) => o.shipCall === "SUM-B");
  await pool.query("UPDATE drivers SET license = '2099-12-31' WHERE id = 'D001'");
  await pool.query("UPDATE vehicles SET maintenance = '2099-12-31' WHERE id = 'V001'");
  await api("PATCH", `/api/orders/${orders[0].id}/dispatch`, { driverId: "D001", vehicleId: "V001" });
  const after = (await api("GET", "/api/orders/task-summary")).data.groups.find((g) => g.shipCall === "SUM-B");
  assert.deepStrictEqual([after.pending, after.dispatched, after.completed], [0, 1, 0]);
});

test("summary: filtered by the date part of 作業時間; invalid dates rejected; login required", async () => {
  await pool.query("DELETE FROM orders");
  await task({ shipCall: "D-1", ship: "ONE", time: "2026-10-10T23:30", qty20: 1 });
  await task({ shipCall: "D-2", ship: "TWO", time: "2026-10-11T00:15", qty20: 2 });

  const d10 = (await api("GET", "/api/orders/task-summary?date=2026-10-10")).data;
  assert.deepStrictEqual(d10.groups.map((g) => g.shipCall), ["D-1"], "23:30 屬於 10/10,00:15 屬於 10/11");
  assert.strictEqual(d10.totals.total, 1);
  const d11 = (await api("GET", "/api/orders/task-summary?date=2026-10-11")).data;
  assert.deepStrictEqual(d11.groups.map((g) => g.shipCall), ["D-2"]);
  assert.strictEqual((await api("GET", "/api/orders/task-summary?date=2026-10-12")).data.groups.length, 0);
  assert.strictEqual((await api("GET", "/api/orders/task-summary")).data.totals.total, 3);

  for (const bad of ["abc", "2026-02-31", "2026-13-01", "10/10", "2026-1-1"]) {
    assert.strictEqual((await api("GET", `/api/orders/task-summary?date=${bad}`)).status, 400, bad);
  }
  assert.strictEqual((await call("GET", "/api/orders/task-summary", {})).status, 401);
});

test("import accepts an optional 船掛 and free-text 船商; CSV export has a 船掛 column", async () => {
  await pool.query("DELETE FROM orders");
  const ok = await api("POST", "/api/orders/import", { rows: [
    { shipCall: "IMP-1", ship: "", carrier: "隨便船商", container: "IMPU0000001", from: "A", to: "B", time: "2026-10-12 09:00", size: "40HQ", dispatchType: "cy" },
  ] }, ops);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.data));
  const o = (await api("GET", "/api/orders")).data[0];
  assert.deepStrictEqual([o.shipCall, o.ship, o.carrier, o.size, o.dispatchType], ["IMP-1", "船掛 IMP-1", "隨便船商", "40HQ", "CY"]);

  const csv = (await call("GET", "/api/orders/export/csv", admin)).raw;
  const header = csv.replace("\ufeff", "").split("\n")[0];
  assert.ok(header.includes("船掛") && header.includes("船商"));
  assert.ok(csv.includes("IMP-1"));
});

test("audit log records the task creation; LINE text shows 船掛 and a placeholder for a missing container number", async () => {
  await task({ shipCall: "AUD-1", qty20: 1, qty40: 1 });
  const logs = (await api("GET", "/api/audit-logs?limit=50")).data;
  const entry = logs.find((l) => l.action === "建立任務");
  assert.ok(entry);
  assert.match(entry.detail, /船掛 AUD-1/);
  assert.match(entry.detail, /20×1 40×1 HQ×0/);

  const orders = (await ordersOf("AUD-1"));
  const { text } = buildDispatchText(orders, [], [], { now: new Date("2026-10-10T01:00:00Z") });
  assert.match(text, /🚢 EHIME \/ 012\(愛媛\)・船掛 AUD-1/);
  assert.match(text, /\(待補櫃號\)　20 呎/);
  assert.ok(!/\d\. 　/.test(text), "不能出現空白的櫃號");

  // 船名留白時列表名稱本身就是「船掛 xxx」,不要再重複一次船掛
  const noName = await task({ shipCall: "DUP-1", ship: "", qty20: 1 });
  const dup = buildDispatchText(noName.data.orders, [], [], { now: new Date("2026-10-10T01:00:00Z") }).text;
  assert.match(dup, /🚢 船掛 DUP-1\(愛媛\)\n/);
  assert.ok(!dup.includes("・船掛 DUP-1"));
});
