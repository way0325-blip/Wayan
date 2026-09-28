const test = require("node:test");
const assert = require("node:assert");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");
const app = require("../index");

let server;
let base;
const tokens = {};

async function rawLogin(username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, data: await res.json() };
}

// 登入次數受速率限制,同一帳號只登入一次並快取 token
async function authFor(username, password) {
  if (!tokens[username]) {
    const { data } = await rawLogin(username, password);
    tokens[username] = { Authorization: "Bearer " + data.token, "Content-Type": "application/json" };
  }
  return tokens[username];
}

async function call(method, path, headers, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

test.before(async () => {
  await pool.query("DROP TABLE IF EXISTS audit_logs, settings, orders, drivers, vehicles, users CASCADE");
  await initDb();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await pool.end();
});

test("health check responds ok", async () => {
  const r = await call("GET", "/api/health", {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, "ok");
});

test("login succeeds with seeded admin account and rejects wrong password", async () => {
  const ok = await rawLogin("admin", "1234");
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.role, "admin");
  const bad = await rawLogin("admin", "wrong");
  assert.strictEqual(bad.status, 401);
});

test("orders endpoint requires authentication", async () => {
  const r = await call("GET", "/api/orders", {});
  assert.strictEqual(r.status, 401);
});

test("dispatch flow: seeded pending order can be dispatched", async () => {
  const admin = await authFor("admin", "1234");
  const orders = (await call("GET", "/api/orders", admin)).data;
  const pending = orders.find((o) => o.status === "待派車");
  assert.ok(pending);

  const r = await call("PATCH", `/api/orders/${pending.id}/dispatch`, admin, {
    driverId: "D002",
    vehicleId: "V002",
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, "已派車");
});

test("role permissions: dispatcher cannot manage users or delete records", async () => {
  const admin = await authFor("admin", "1234");
  const created = await call("POST", "/api/users", admin, { username: "ops1", password: "pass1234", role: "dispatcher" });
  assert.strictEqual(created.status, 201);

  const ops = await authFor("ops1", "pass1234");
  assert.strictEqual((await call("GET", "/api/users", ops)).status, 403);
  assert.strictEqual((await call("GET", "/api/audit-logs", ops)).status, 403);
  assert.strictEqual((await call("PUT", "/api/settings", ops, { announcement: "x" })).status, 403);

  const driver = await call("POST", "/api/drivers", ops, { name: "測試司機", phone: "0900-000-000", license: "2030-01-01" });
  assert.strictEqual(driver.status, 201);
  assert.strictEqual((await call("DELETE", `/api/drivers/${driver.data.id}`, ops)).status, 403);
  assert.strictEqual((await call("DELETE", `/api/drivers/${driver.data.id}`, admin)).status, 204);
});

test("input validation rejects malformed order payloads", async () => {
  const admin = await authFor("admin", "1234");
  const r = await call("POST", "/api/orders", admin, {
    ship: "", container: "X", from: "A", to: "B", time: "not-a-date", size: "999 呎",
  });
  assert.strictEqual(r.status, 400);
  assert.ok(r.data.details.length > 0);
});

test("admin can change role, reset password, deactivate; deactivated users are locked out immediately", async () => {
  const admin = await authFor("admin", "1234");
  const created = await call("POST", "/api/users", admin, { username: "temp1", password: "temp1234", role: "dispatcher" });
  const id = created.data.id;

  const temp = await authFor("temp1", "temp1234");
  assert.strictEqual((await call("GET", "/api/orders", temp)).status, 200);

  const promote = await call("PATCH", `/api/users/${id}`, admin, { role: "admin" });
  assert.strictEqual(promote.data.role, "admin");
  // 角色以資料庫為準,升級立即生效
  assert.strictEqual((await call("GET", "/api/users", temp)).status, 200);

  await call("PATCH", `/api/users/${id}`, admin, { role: "dispatcher" });
  assert.strictEqual((await call("GET", "/api/users", temp)).status, 403);

  const reset = await call("PATCH", `/api/users/${id}`, admin, { password: "newpass99" });
  assert.strictEqual(reset.status, 200);

  await call("PATCH", `/api/users/${id}`, admin, { active: false });
  assert.strictEqual((await call("GET", "/api/orders", temp)).status, 401);
  const blocked = await rawLogin("temp1", "newpass99");
  assert.strictEqual(blocked.status, 403);
});

test("safeguards: cannot deactivate yourself or the last admin; short passwords rejected", async () => {
  const admin = await authFor("admin", "1234");
  const users = (await call("GET", "/api/users", admin)).data;
  const me = users.find((u) => u.username === "admin");

  assert.strictEqual((await call("PATCH", `/api/users/${me.id}`, admin, { active: false })).status, 400);
  assert.strictEqual((await call("PATCH", `/api/users/${me.id}`, admin, { role: "dispatcher" })).status, 400);
  assert.strictEqual((await call("DELETE", `/api/users/${me.id}`, admin)).status, 400);
  assert.strictEqual((await call("PATCH", `/api/users/${me.id}`, admin, { password: "123" })).status, 400);
});

test("settings: admin edits content; new container size is accepted by orders", async () => {
  const admin = await authFor("admin", "1234");
  const ops = await authFor("ops1", "pass1234");

  const pub = await call("GET", "/api/settings/public", {});
  assert.strictEqual(pub.status, 200);
  assert.ok(pub.data.systemName);
  assert.strictEqual(pub.data.announcement, undefined);

  const bad = await call("POST", "/api/orders", ops, { ship: "S", container: "C1", from: "A", to: "B", time: "2026-10-01T09:00", size: "53 呎" });
  assert.strictEqual(bad.status, 400);

  const put = await call("PUT", "/api/settings", admin, {
    systemName: "測試調度中心",
    announcement: "明天颱風,請注意",
    locations: ["高雄港", "高雄港", " 台中港 "],
    containerSizes: ["20 呎", "40 呎", "53 呎"],
  });
  assert.strictEqual(put.status, 200);
  assert.deepStrictEqual(put.data.locations, ["高雄港", "台中港"]);

  const good = await call("POST", "/api/orders", ops, { ship: "S", container: "C1", from: "A", to: "B", time: "2026-10-01T09:00", size: "53 呎" });
  assert.strictEqual(good.status, 201);

  assert.strictEqual((await call("PUT", "/api/settings", admin, { systemName: "" })).status, 400);
  assert.strictEqual((await call("PUT", "/api/settings", admin, { containerSizes: [] })).status, 400);
  assert.strictEqual((await call("GET", "/api/settings", ops)).data.announcement, "明天颱風,請注意");
});

test("batch import: valid rows are inserted, any invalid row rejects the whole batch", async () => {
  const ops = await authFor("ops1", "pass1234");
  const before = (await call("GET", "/api/orders", ops)).data.length;

  const bad = await call("POST", "/api/orders/import", ops, {
    rows: [
      { ship: "A", container: "C1", from: "X", to: "Y", time: "2026-10-02 08:00", size: "20 呎" },
      { ship: "", container: "C2", from: "X", to: "Y", time: "壞掉", size: "99 呎" },
    ],
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.data.details[0].row, 2);
  assert.strictEqual((await call("GET", "/api/orders", ops)).data.length, before);

  const ok = await call("POST", "/api/orders/import", ops, {
    rows: [
      { ship: "A", container: "C1", from: "X", to: "Y", time: "2026-10-02 08:00", size: "20 呎" },
      { ship: "B", container: "C2", from: "X", to: "Y", time: "2026-10-02T09:30", size: "40 呎" },
    ],
  });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.data.imported, 2);
  assert.strictEqual((await call("GET", "/api/orders", ops)).data.length, before + 2);
});

test("reassign swaps resources; admin can force status back to pending", async () => {
  const admin = await authFor("admin", "1234");
  const ops = await authFor("ops1", "pass1234");

  await call("POST", "/api/vehicles", admin, { plate: "NEW-0001", type: "曳引車", maintenance: "2030-01-01" });
  const vehicles = (await call("GET", "/api/vehicles", admin)).data;
  const newVehicle = vehicles.find((v) => v.plate === "NEW-0001");

  const orders = (await call("GET", "/api/orders", admin)).data;
  const dispatched = orders.find((o) => o.status === "已派車" && o.driverId === "D002");
  assert.ok(dispatched);

  // 只換車、司機不變也要成功
  const re = await call("PATCH", `/api/orders/${dispatched.id}/reassign`, ops, { driverId: "D002", vehicleId: newVehicle.id });
  assert.strictEqual(re.status, 200);
  assert.strictEqual(re.data.vehicleId, newVehicle.id);

  const after = (await call("GET", "/api/vehicles", admin)).data;
  assert.strictEqual(after.find((v) => v.id === "V002").status, "可用");
  assert.strictEqual(after.find((v) => v.id === newVehicle.id).status, "執行中");

  assert.strictEqual((await call("PATCH", `/api/orders/${dispatched.id}/reassign`, ops, { driverId: "D002", vehicleId: newVehicle.id })).status, 400);
  assert.strictEqual((await call("PATCH", `/api/orders/${dispatched.id}/status`, ops, { status: "待派車" })).status, 403);

  const back = await call("PATCH", `/api/orders/${dispatched.id}/status`, admin, { status: "待派車" });
  assert.strictEqual(back.data.status, "待派車");
  assert.strictEqual(back.data.driverId, null);
  const drivers = (await call("GET", "/api/drivers", admin)).data;
  assert.strictEqual(drivers.find((d) => d.id === "D002").status, "可派車");
});

test("audit log records who changed what, visible to admin only", async () => {
  const admin = await authFor("admin", "1234");
  const logs = await call("GET", "/api/audit-logs?limit=200", admin);
  assert.strictEqual(logs.status, 200);
  const actions = logs.data.map((l) => `${l.action}:${l.entity}`);
  for (const expected of ["登入:使用者", "新增:使用者", "修改:使用者", "修改:網站設定", "批次匯入:訂單", "改派:訂單", "強制改狀態:訂單", "派車:訂單"]) {
    assert.ok(actions.includes(expected), `缺少紀錄:${expected}`);
  }
  assert.ok(logs.data.every((l) => !/newpass99|pass1234/.test(l.detail || "")), "紀錄不得包含密碼");
  assert.strictEqual((await call("GET", "/api/audit-logs?entity=網站設定", admin)).data.every((l) => l.entity === "網站設定"), true);
});

test("csv export neutralises formula injection", async () => {
  const admin = await authFor("admin", "1234");
  await call("POST", "/api/orders", admin, { ship: "=HYPERLINK(\"http://x\")", container: "CSV1", from: "A", to: "B", time: "2026-10-03T10:00", size: "20 呎" });
  const r = await fetch(`${base}/api/orders/export/csv`, { headers: admin });
  const text = await r.text();
  assert.ok(text.includes(`"'=HYPERLINK`));
});

test("login rate limiting blocks repeated failed attempts", async () => {
  let last;
  for (let i = 0; i < 15; i++) {
    last = (await rawLogin("admin", "wrong")).status;
    if (last === 429) break;
  }
  assert.strictEqual(last, 429);
});
