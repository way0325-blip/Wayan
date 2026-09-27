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

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function login(base, username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS orders, drivers, vehicles, users CASCADE"
  );
  await initDb();
});

test.after(async () => {
  await pool.end();
});

test("health check responds ok", async () => {
  const server = await listen();
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, "ok");

  server.close();
});

test("login succeeds with seeded admin account and rejects wrong password", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const ok = await login(base, "admin", "1234");
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.data.token);
  assert.strictEqual(ok.data.role, "admin");

  const bad = await login(base, "admin", "wrong");
  assert.strictEqual(bad.status, 401);

  server.close();
});

test("orders endpoint requires authentication", async () => {
  const server = await listen();
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/orders`);
  assert.strictEqual(res.status, 401);

  server.close();
});

test("dispatch flow: seeded pending order can be dispatched to an available driver/vehicle", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const { data: loginData } = await login(base, "admin", "1234");
  const auth = { Authorization: "Bearer " + loginData.token, "Content-Type": "application/json" };

  const orders = await (await fetch(`${base}/api/orders`, { headers: auth })).json();
  const pending = orders.find((o) => o.status === "待派車");
  assert.ok(pending, "應該有一筆種子資料是待派車狀態");

  const dispatch = await fetch(`${base}/api/orders/${pending.id}/dispatch`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ driverId: "D002", vehicleId: "V002" }),
  });
  const dispatched = await dispatch.json();
  assert.strictEqual(dispatch.status, 200);
  assert.strictEqual(dispatched.status, "已派車");

  server.close();
});

test("role permissions: dispatcher cannot manage users or delete records, admin can", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const { data: adminLogin } = await login(base, "admin", "1234");
  const adminAuth = { Authorization: "Bearer " + adminLogin.token, "Content-Type": "application/json" };

  // 管理員新增一個 dispatcher 帳號
  const createUser = await fetch(`${base}/api/users`, {
    method: "POST",
    headers: adminAuth,
    body: JSON.stringify({ username: "ops1", password: "pass1234", role: "dispatcher" }),
  });
  assert.strictEqual(createUser.status, 201);

  const { data: dispatcherLogin } = await login(base, "ops1", "pass1234");
  assert.strictEqual(dispatcherLogin.role, "dispatcher");
  const dispatcherAuth = { Authorization: "Bearer " + dispatcherLogin.token, "Content-Type": "application/json" };

  // dispatcher 不能列使用者清單
  const listUsersAsDispatcher = await fetch(`${base}/api/users`, { headers: dispatcherAuth });
  assert.strictEqual(listUsersAsDispatcher.status, 403);

  // dispatcher 可以新增司機,但不能刪除
  const newDriver = await fetch(`${base}/api/drivers`, {
    method: "POST",
    headers: dispatcherAuth,
    body: JSON.stringify({ name: "測試司機", phone: "0900-000-000", license: "2030-01-01" }),
  });
  assert.strictEqual(newDriver.status, 201);
  const driverData = await newDriver.json();

  const deleteAsDispatcher = await fetch(`${base}/api/drivers/${driverData.id}`, {
    method: "DELETE",
    headers: dispatcherAuth,
  });
  assert.strictEqual(deleteAsDispatcher.status, 403);

  const deleteAsAdmin = await fetch(`${base}/api/drivers/${driverData.id}`, {
    method: "DELETE",
    headers: adminAuth,
  });
  assert.strictEqual(deleteAsAdmin.status, 204);

  server.close();
});

test("input validation rejects malformed order payloads", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const { data: loginData } = await login(base, "admin", "1234");
  const auth = { Authorization: "Bearer " + loginData.token, "Content-Type": "application/json" };

  const res = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ ship: "", container: "X", from: "A", to: "B", time: "not-a-date", size: "999 呎" }),
  });

  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(Array.isArray(data.details) && data.details.length > 0);

  server.close();
});

test("login rate limiting blocks repeated failed attempts", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  let lastStatus;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    lastStatus = res.status;
    if (lastStatus === 429) break;
  }

  assert.strictEqual(lastStatus, 429);

  server.close();
});
