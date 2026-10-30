const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "driver-performance-test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");
let app, server, base, adminAuth, dispatcherAuth;

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
  await pool.query("DROP TABLE IF EXISTS driver_performance_event_history, driver_performance_events CASCADE");
  await pool.query("DROP TABLE IF EXISTS attendance_records, dispatch_staff, vehicle_maintenance_items, audit_logs, settings, line_daily_index, orders, drivers, vehicles, users CASCADE");
  await initDb();
  app = require("../index");
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "admin", password: "1234" });
  adminAuth = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };

  await call("POST", "/api/users", adminAuth, { username: "driver-ops", password: "pass1234", role: "dispatcher" });
  const dispatcherLogin = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "driver-ops", password: "pass1234" });
  dispatcherAuth = { Authorization: "Bearer " + dispatcherLogin.data.token, "Content-Type": "application/json" };
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test("driver performance: records lateness, calculates points, and only confirmed events accumulate", async () => {
  const driver = await call("POST", "/api/drivers", adminAuth, {
    name: "績效測試司機", phone: "0900000123", license: "2027-12-31",
  });
  assert.equal(driver.status, 201);
  const driverId = driver.data.id;

  const badTime = await call("POST", "/api/driver-performance/events", adminAuth, {
    driverId, eventType: "遲到", eventDate: "2026-10-30", scheduledTime: "08:00", actualTime: "07:59",
  });
  assert.equal(badTime.status, 400);

  const created = await call("POST", "/api/driver-performance/events", adminAuth, {
    driverId, eventType: "遲到", eventDate: "2026-10-30", scheduledTime: "08:00", actualTime: "08:04",
    reason: "交通壅塞", note: "司機回報路段施工",
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.late_minutes, 4);
  assert.equal(created.data.points, 1);
  assert.equal(created.data.review_status, "待覆核");

  const monthBeforeReview = await call("GET", "/api/driver-performance?period=month&month=2026-10", adminAuth);
  const rowBefore = monthBeforeReview.data.summary.find((r) => r.driver_id === driverId);
  assert.equal(rowBefore.pending_count, 1);
  assert.equal(rowBefore.late_count, 0);
  assert.equal(rowBefore.confirmed_points, 0);

  const forbidden = await call("PATCH", `/api/driver-performance/events/${created.data.id}/review`, dispatcherAuth, {
    status: "已確認",
  });
  assert.equal(forbidden.status, 403);

  const confirmed = await call("PATCH", `/api/driver-performance/events/${created.data.id}/review`, adminAuth, {
    status: "已確認", reviewNote: "查證屬實",
  });
  assert.equal(confirmed.status, 200);

  const monthAfterReview = await call("GET", "/api/driver-performance?period=month&month=2026-10", adminAuth);
  const rowAfter = monthAfterReview.data.summary.find((r) => r.driver_id === driverId);
  assert.equal(rowAfter.late_count, 1);
  assert.equal(rowAfter.late_minutes, 4);
  assert.equal(rowAfter.confirmed_points, 1);

  const quarter = await call("GET", "/api/driver-performance?period=quarter&month=2026-10", adminAuth);
  assert.equal(quarter.data.startDate, "2026-10-01");
  assert.equal(quarter.data.endDate, "2027-01-01");

  const year = await call("GET", "/api/driver-performance?period=year&month=2026-10", adminAuth);
  assert.equal(year.data.startDate, "2026-01-01");
  assert.equal(year.data.endDate, "2027-01-01");

  const cannotDelete = await call("DELETE", `/api/drivers/${driverId}`, adminAuth);
  assert.equal(cannotDelete.status, 409);
});

test("driver performance: exclusion requires a reason and does not count points", async () => {
  const driver = await call("POST", "/api/drivers", adminAuth, {
    name: "排除測試司機", phone: "0900000456", license: "2027-12-31",
  });
  const created = await call("POST", "/api/driver-performance/events", adminAuth, {
    driverId: driver.data.id, eventType: "遲到", eventDate: "2026-10-29",
    scheduledTime: "09:00", actualTime: "09:12", reason: "場站管制",
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.points, 2);

  const missingReason = await call("PATCH", `/api/driver-performance/events/${created.data.id}/review`, adminAuth, {
    status: "核准排除",
  });
  assert.equal(missingReason.status, 400);

  const excluded = await call("PATCH", `/api/driver-performance/events/${created.data.id}/review`, adminAuth, {
    status: "核准排除", reviewNote: "場站管制非司機可控制",
  });
  assert.equal(excluded.status, 200);

  const summary = await call("GET", "/api/driver-performance?period=month&month=2026-10", adminAuth);
  const row = summary.data.summary.find((r) => r.driver_id === driver.data.id);
  assert.equal(row.late_count, 0);
  assert.equal(row.confirmed_points, 0);
  assert.equal(row.excluded_count, 1);
});
