const test = require("node:test");
const assert = require("node:assert");

process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const app = require("../index");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test("health check responds ok", async () => {
  const server = await listen(app);
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, "ok");

  server.close();
});

test("login succeeds with seeded admin account and rejects wrong password", async () => {
  const server = await listen(app);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const ok = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "1234" }),
  });
  const okData = await ok.json();
  assert.strictEqual(ok.status, 200);
  assert.ok(okData.token);

  const bad = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  assert.strictEqual(bad.status, 401);

  server.close();
});

test("orders endpoint requires authentication", async () => {
  const server = await listen(app);
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/orders`);
  assert.strictEqual(res.status, 401);

  server.close();
});

test("dispatch flow: seeded pending order can be dispatched to an available driver/vehicle", async () => {
  const server = await listen(app);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "1234" }),
  });
  const { token } = await login.json();
  const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

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
