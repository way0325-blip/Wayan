const test = require("node:test");
const { mock } = test;
const assert = require("node:assert");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");
const { todayInTaipei, addDays } = require("../dates");

let app, server, base, adminAuth;

async function call(method, path, headers, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

test.before(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS attendance_records, dispatch_staff, vehicle_maintenance_items, audit_logs, settings, line_daily_index, orders, drivers, vehicles, users CASCADE"
  );
  await initDb();
  app = require("../index");
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "admin", password: "1234" });
  adminAuth = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };
});

test.after(async () => {
  server.close();
  await pool.end();
});

function daysFromNow(n) {
  return addDays(todayInTaipei(), n);
}

test("vehicle inspection_date is created, editable, and shows up correctly", async () => {
  const created = await call("POST", "/api/vehicles", adminAuth, {
    plate: "INSP-0001",
    type: "曳引車",
    maintenance: daysFromNow(100),
    inspectionDate: daysFromNow(10),
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.inspection_date, daysFromNow(10));

  const edited = await call("PATCH", `/api/vehicles/${created.data.id}`, adminAuth, { inspectionDate: daysFromNow(5) });
  assert.strictEqual(edited.data.inspection_date, daysFromNow(5));
});

test("vehicle maintenance items: add, list, edit, delete; non-existent vehicle rejected", async () => {
  const vehicle = await call("POST", "/api/vehicles", adminAuth, {
    plate: "ITEM-0001", type: "曳引車", maintenance: daysFromNow(200),
  });
  const vId = vehicle.data.id;

  const missing = await call("POST", "/api/vehicles/NOPE/maintenance-items", adminAuth, { itemName: "機油", dueDate: daysFromNow(10) });
  assert.strictEqual(missing.status, 404);

  const added = await call("POST", `/api/vehicles/${vId}/maintenance-items`, adminAuth, { itemName: "機油更換", dueDate: daysFromNow(20) });
  assert.strictEqual(added.status, 201);
  const itemId = added.data.id;

  const list = await call("GET", `/api/vehicles/${vId}/maintenance-items`, adminAuth);
  assert.strictEqual(list.data.length, 1);
  assert.strictEqual(list.data[0].item_name, "機油更換");

  const edited = await call("PATCH", `/api/vehicle-maintenance-items/${itemId}`, adminAuth, { dueDate: daysFromNow(25), note: "合成機油" });
  assert.strictEqual(edited.data.due_date, daysFromNow(25));
  assert.strictEqual(edited.data.note, "合成機油");

  const del = await call("DELETE", `/api/vehicle-maintenance-items/${itemId}`, adminAuth);
  assert.strictEqual(del.status, 204);
  assert.strictEqual((await call("GET", `/api/vehicles/${vId}/maintenance-items`, adminAuth)).data.length, 0);
});

test("deleting a vehicle cascades its maintenance items", async () => {
  const vehicle = await call("POST", "/api/vehicles", adminAuth, { plate: "CASC-0001", type: "曳引車", maintenance: daysFromNow(200) });
  await call("POST", `/api/vehicles/${vehicle.data.id}/maintenance-items`, adminAuth, { itemName: "輪胎", dueDate: daysFromNow(15) });

  const del = await call("DELETE", `/api/vehicles/${vehicle.data.id}`, adminAuth);
  assert.strictEqual(del.status, 204);

  const orphans = await pool.query("SELECT * FROM vehicle_maintenance_items WHERE vehicle_id = $1", [vehicle.data.id]);
  assert.strictEqual(orphans.rows.length, 0);
});

test("alerts: shows overdue and within-30-day items, hides far-future ones, across drivers/maintenance/inspection/items", async () => {
  await call("POST", "/api/drivers", adminAuth, { name: "警示測試司機A", phone: "0900000001", license: daysFromNow(-3) }); // 已逾期
  await call("POST", "/api/drivers", adminAuth, { name: "警示測試司機B", phone: "0900000002", license: daysFromNow(400) }); // 很久以後,不該出現

  const v1 = await call("POST", "/api/vehicles", adminAuth, { plate: "ALERT-0001", type: "曳引車", maintenance: daysFromNow(10), inspectionDate: daysFromNow(400) });
  const v2 = await call("POST", "/api/vehicles", adminAuth, { plate: "ALERT-0002", type: "曳引車", maintenance: daysFromNow(400), inspectionDate: daysFromNow(2) });
  await call("POST", `/api/vehicles/${v2.data.id}/maintenance-items`, adminAuth, { itemName: "煞車來令片", dueDate: daysFromNow(29) });
  await call("POST", `/api/vehicles/${v2.data.id}/maintenance-items`, adminAuth, { itemName: "冷氣濾網", dueDate: daysFromNow(200) });

  const alerts = (await call("GET", "/api/alerts", adminAuth)).data;

  const overdueDriver = alerts.find((a) => a.type === "driver_license" && a.refLabel === "警示測試司機A");
  assert.ok(overdueDriver);
  assert.strictEqual(overdueDriver.severity, "overdue");
  assert.match(overdueDriver.message, /已逾期 3 天/);

  assert.ok(!alerts.some((a) => a.refLabel === "警示測試司機B"));

  assert.ok(alerts.some((a) => a.type === "vehicle_maintenance" && a.refLabel === "ALERT-0001" && a.daysUntil === 10));
  assert.ok(alerts.some((a) => a.type === "vehicle_inspection" && a.refLabel === "ALERT-0002" && a.daysUntil === 2));
  assert.ok(alerts.some((a) => a.type === "vehicle_item" && a.label.includes("煞車來令片")));
  assert.ok(!alerts.some((a) => a.label && a.label.includes("冷氣濾網")));

  assert.ok(alerts.every((a, i) => i === 0 || alerts[i - 1].daysUntil <= a.daysUntil), "alerts 應依到期天數排序");
});

test("dispatch staff: create, edit, deactivate, delete requires admin", async () => {
  const created = await call("POST", "/api/dispatch-staff", adminAuth, { name: "調度員小李", phone: "0911000000" });
  assert.strictEqual(created.status, 201);
  const id = created.data.id;

  const list = await call("GET", "/api/dispatch-staff", adminAuth);
  assert.ok(list.data.some((s) => s.id === id));

  const edited = await call("PATCH", `/api/dispatch-staff/${id}`, adminAuth, { phone: "0922111111" });
  assert.strictEqual(edited.data.phone, "0922111111");

  const deactivated = await call("PATCH", `/api/dispatch-staff/${id}`, adminAuth, { active: false });
  assert.strictEqual(deactivated.data.active, false);

  const createdDisp = await call("POST", "/api/users", adminAuth, { username: "ops-maint", password: "pass1234", role: "dispatcher" });
  const opsLogin = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "ops-maint", password: "pass1234" });
  const opsAuth = { Authorization: "Bearer " + opsLogin.data.token, "Content-Type": "application/json" };

  assert.strictEqual((await call("DELETE", `/api/dispatch-staff/${id}`, opsAuth)).status, 403);
  assert.strictEqual((await call("DELETE", `/api/dispatch-staff/${id}`, adminAuth)).status, 204);
});

test("attendance: set/overwrite/clear a day for a dispatcher, list only shows active staff, validates type/month/status", async () => {
  const active = await call("POST", "/api/dispatch-staff", adminAuth, { name: "出勤測試-在職", phone: "" });
  const inactiveRaw = await call("POST", "/api/dispatch-staff", adminAuth, { name: "出勤測試-停用", phone: "" });
  await call("PATCH", `/api/dispatch-staff/${inactiveRaw.data.id}`, adminAuth, { active: false });

  assert.strictEqual((await call("GET", "/api/attendance?type=alien&month=2026-10", adminAuth)).status, 400);
  assert.strictEqual((await call("GET", "/api/attendance?type=dispatcher&month=2026/10", adminAuth)).status, 400);

  const monthView = await call("GET", "/api/attendance?type=dispatcher&month=2026-10", adminAuth);
  assert.strictEqual(monthView.status, 200);
  assert.ok(monthView.data.staff.some((s) => s.id === active.data.id));
  assert.ok(!monthView.data.staff.some((s) => s.id === inactiveRaw.data.id), "已停用的調度人員不該出現在班表");

  const badStatus = await call("PUT", "/api/attendance", adminAuth, { staffType: "dispatcher", staffId: active.data.id, date: "2026-10-05", status: "摸魚" });
  assert.strictEqual(badStatus.status, 400);

  const setLeave = await call("PUT", "/api/attendance", adminAuth, { staffType: "dispatcher", staffId: active.data.id, date: "2026-10-05", status: "休假" });
  assert.strictEqual(setLeave.status, 200);
  assert.strictEqual(setLeave.data.status, "休假");

  const overwrite = await call("PUT", "/api/attendance", adminAuth, { staffType: "dispatcher", staffId: active.data.id, date: "2026-10-05", status: "出勤" });
  assert.strictEqual(overwrite.data.status, "出勤");

  const afterSet = await call("GET", "/api/attendance?type=dispatcher&month=2026-10", adminAuth);
  assert.strictEqual(afterSet.data.records.length, 1);
  assert.strictEqual(afterSet.data.records[0].status, "出勤");

  const cleared = await call("PUT", "/api/attendance", adminAuth, { staffType: "dispatcher", staffId: active.data.id, date: "2026-10-05" });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.data.status, null);

  const afterClear = await call("GET", "/api/attendance?type=dispatcher&month=2026-10", adminAuth);
  assert.strictEqual(afterClear.data.records.length, 0);
});

test("attendance works for driver type too, and rejects unknown staff id", async () => {
  const drivers = (await call("GET", "/api/drivers", adminAuth)).data;
  const driverId = drivers[0].id;

  const unknown = await call("PUT", "/api/attendance", adminAuth, { staffType: "driver", staffId: "NOPE", date: "2026-10-01", status: "曠職" });
  assert.strictEqual(unknown.status, 404);

  const ok = await call("PUT", "/api/attendance", adminAuth, { staffType: "driver", staffId: driverId, date: "2026-10-01", status: "曠職" });
  assert.strictEqual(ok.status, 200);

  const view = await call("GET", "/api/attendance?type=driver&month=2026-10", adminAuth);
  assert.ok(view.data.staff.some((s) => s.id === driverId));
  assert.ok(view.data.records.some((r) => r.staff_id === driverId && r.status === "曠職"));
});

test("alerts at 01:30 Taipei (UTC still previous day): 「今天到期」 is day 0, not day 1", async () => {
  // 台灣 2026-10-09 01:30 = UTC 2026-10-08 17:30
  const v = await call("POST", "/api/vehicles", adminAuth, { plate: "TZ-0001", type: "曳引車", maintenance: "2099-01-01", inspectionDate: "2026-10-09" });
  await call("POST", `/api/vehicles/${v.data.id}/maintenance-items`, adminAuth, { itemName: "昨天到期的項目", dueDate: "2026-10-08" });
  await call("POST", `/api/vehicles/${v.data.id}/maintenance-items`, adminAuth, { itemName: "30天後的項目", dueDate: "2026-11-08" });
  await call("POST", `/api/vehicles/${v.data.id}/maintenance-items`, adminAuth, { itemName: "31天後的項目", dueDate: "2026-11-09" });

  const { computeAlerts } = require("../alerts");
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-08T17:30:00Z") });
  let alerts;
  try {
    alerts = await computeAlerts();
  } finally {
    mock.timers.reset();
  }

  const insp = alerts.find((a) => a.type === "vehicle_inspection" && a.refLabel === "TZ-0001");
  assert.strictEqual(insp.daysUntil, 0);
  assert.match(insp.message, /今天到期/);

  const yesterday = alerts.find((a) => a.label.includes("昨天到期的項目"));
  assert.strictEqual(yesterday.daysUntil, -1);
  assert.strictEqual(yesterday.severity, "overdue");

  assert.ok(alerts.some((a) => a.label.includes("30天後的項目") && a.daysUntil === 30), "第 30 天剛好進入提醒範圍");
  assert.ok(!alerts.some((a) => a.label.includes("31天後的項目")), "第 31 天還不提醒");
});
