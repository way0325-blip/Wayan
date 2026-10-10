const test = require("node:test");
const assert = require("node:assert");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");

let server, base, admin, ops;
const D = "2026-10-09";

async function call(method, path, headers, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const api = (m, p, b, who = admin) => call(m, p, who, b);

async function newFleet(name, extra = {}) {
  const r = await api("POST", "/api/shopee/fleets", { name, contactName: "王先生", phone: "0900", ...extra });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function newCap(fleetId, o, d, type, max) {
  const r = await api("POST", `/api/shopee/fleets/${fleetId}/routes`, { origin: o, destination: d, vehicleType: type, maxTrucks: max });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
async function newRoute(o, d, type, trucks, date = D) {
  const r = await api("POST", "/api/shopee/routes", { serviceDate: date, origin: o, destination: d, vehicleType: type, requiredTrucks: trucks });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const candidates = async (routeId) => (await api("GET", `/api/shopee/routes/${routeId}/candidates`)).data;

test.before(async () => {
  await pool.query("DROP TABLE IF EXISTS shopee_assignments, fleet_routes, partner_fleets, shopee_routes CASCADE");
  await pool.query("DROP TABLE IF EXISTS attendance_records, dispatch_staff, vehicle_maintenance_items, audit_logs, settings, line_daily_index, orders, drivers, vehicles, users CASCADE");
  await initDb();
  const app = require("../index");
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "admin", password: "1234" });
  admin = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };
  await api("POST", "/api/users", { username: "shopee-ops", password: "pass1234", role: "dispatcher" });
  const l2 = await call("POST", "/api/auth/login", { "Content-Type": "application/json" }, { username: "shopee-ops", password: "pass1234" });
  ops = { Authorization: "Bearer " + l2.data.token, "Content-Type": "application/json" };
});

test.after(async () => { server.close(); await pool.end(); });

test("requires login", async () => {
  assert.strictEqual((await call("GET", "/api/shopee/routes", {})).status, 401);
  assert.strictEqual((await call("GET", "/api/shopee/fleets", {})).status, 401);
});

test("demand validation: date must be a real date, vehicle type from settings, truck count integer", async () => {
  const good = { serviceDate: D, origin: "台北", destination: "桃園", vehicleType: "3.5T", requiredTrucks: 2 };
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, serviceDate: "2026-02-31" })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, serviceDate: "10/09" })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, vehicleType: "99T" })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, requiredTrucks: 0 })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, requiredTrucks: 1.5 })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, requiredTrucks: "" })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { ...good, origin: "  " })).status, 400);
  const ok = await api("POST", "/api/shopee/routes", good, ops); // dispatcher 也能建立
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.data.shortage, 2);
  assert.strictEqual(ok.data.status, "待分派");
  assert.strictEqual(ok.data.routeName, "台北→桃園");
});

test("vehicle types are configurable by admin only", async () => {
  assert.strictEqual((await api("PUT", "/api/settings", { shopeeVehicleTypes: ["X"] }, ops)).status, 403);
  assert.strictEqual((await api("PUT", "/api/settings", { shopeeVehicleTypes: [] })).status, 400);
  const put = await api("PUT", "/api/settings", { shopeeVehicleTypes: ["3.5T", "11T", "17T", "26T"] });
  assert.deepStrictEqual(put.data.shopeeVehicleTypes, ["3.5T", "11T", "17T", "26T"]);
  assert.strictEqual((await api("POST", "/api/shopee/routes", { serviceDate: D, origin: "A", destination: "B", vehicleType: "26T", requiredTrucks: 1 })).status, 201);
});

test("fleet CRUD: duplicate names rejected, delete is admin-only, capacity validated", async () => {
  const f = await newFleet("測試車隊甲", { dailyCapacity: 5 });
  assert.strictEqual(f.dailyCapacity, 5);
  assert.strictEqual((await api("POST", "/api/shopee/fleets", { name: "測試車隊甲" })).status, 409);
  assert.strictEqual((await api("POST", "/api/shopee/fleets", { name: "x", dailyCapacity: -1 })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/fleets", { name: "x", dailyCapacity: "abc" })).status, 400);

  const edited = await api("PATCH", `/api/shopee/fleets/${f.id}`, { phone: "0911", status: "停用" }, ops);
  assert.strictEqual(edited.data.phone, "0911");
  assert.strictEqual(edited.data.status, "停用");
  assert.strictEqual((await api("PATCH", `/api/shopee/fleets/${f.id}`, { status: "亂寫" })).status, 400);

  assert.strictEqual((await api("DELETE", `/api/shopee/fleets/${f.id}`, undefined, ops)).status, 403);
  assert.strictEqual((await api("DELETE", `/api/shopee/fleets/${f.id}`)).status, 204);
});

test("fleet capabilities: validated, unique per route+type, editable, deletable", async () => {
  const f = await newFleet("能力測試車隊");
  const cap = await newCap(f.id, "桃園", "新竹", "11T", 3);

  const dup = await api("POST", `/api/shopee/fleets/${f.id}/routes`, { origin: "桃園", destination: "新竹", vehicleType: "11T", maxTrucks: 1 });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual((await api("POST", `/api/shopee/fleets/${f.id}/routes`, { origin: "桃園", destination: "新竹", vehicleType: "9T", maxTrucks: 1 })).status, 400);
  assert.strictEqual((await api("POST", `/api/shopee/fleets/${f.id}/routes`, { origin: "桃園", destination: "新竹", vehicleType: "17T", maxTrucks: 0 })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/fleets/NOPE/routes", { origin: "a", destination: "b", vehicleType: "11T", maxTrucks: 1 })).status, 404);

  const upd = await api("PATCH", `/api/shopee/fleet-routes/${cap.id}`, { maxTrucks: 4, active: false });
  assert.strictEqual(upd.data.max_trucks, 4);
  assert.strictEqual(upd.data.active, false);
  assert.strictEqual((await api("PATCH", `/api/shopee/fleet-routes/${cap.id}`, { active: "no" })).status, 400);

  const list = (await api("GET", "/api/shopee/fleets")).data.find((x) => x.id === f.id);
  assert.strictEqual(list.routes.length, 1);

  assert.strictEqual((await api("DELETE", `/api/shopee/fleet-routes/${cap.id}`)).status, 204);
});

test("candidates: only active fleets with an active matching route+vehicle type", async () => {
  const match = await newFleet("候選-符合");
  await newCap(match.id, "台中", "彰化", "3.5T", 3);
  const wrongType = await newFleet("候選-車型不符");
  await newCap(wrongType.id, "台中", "彰化", "11T", 3);
  const wrongRoute = await newFleet("候選-路線不符");
  await newCap(wrongRoute.id, "台中", "南投", "3.5T", 3);
  const stopped = await newFleet("候選-停用車隊");
  await newCap(stopped.id, "台中", "彰化", "3.5T", 3);
  await api("PATCH", `/api/shopee/fleets/${stopped.id}`, { status: "停用" });
  const inactiveCap = await newFleet("候選-停用路線");
  const cap = await newCap(inactiveCap.id, "台中", "彰化", "3.5T", 3);
  await api("PATCH", `/api/shopee/fleet-routes/${cap.id}`, { active: false });

  const route = await newRoute("台中", "彰化", "3.5T", 3);
  const c = await candidates(route.id);
  assert.deepStrictEqual(c.candidates.map((x) => x.name), ["候選-符合"]);
  assert.strictEqual((await api("GET", "/api/shopee/routes/NOPE/candidates")).status, 404);
});

test("assignments: request -> reply -> shortage math and status progression", async () => {
  const a = await newFleet("分派A"); await newCap(a.id, "新竹", "台中", "17T", 3);
  const b = await newFleet("分派B"); await newCap(b.id, "新竹", "台中", "17T", 2);
  const route = await newRoute("新竹", "台中", "17T", 4, "2026-10-10");
  assert.strictEqual(route.status, "待分派");

  // 超過單一路線上限、非候選車隊、重複車隊、0 車 都要被擋,而且整批不寫入
  assert.strictEqual((await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 4 }] })).status, 409);
  assert.strictEqual((await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: "F-NOPE", requestedTrucks: 1 }] })).status, 409);
  assert.strictEqual((await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 1 }, { fleetId: a.id, requestedTrucks: 2 }] })).status, 400);
  assert.strictEqual((await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 0 }] })).status, 400);
  const mixed = await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }, { fleetId: b.id, requestedTrucks: 9 }] });
  assert.strictEqual(mixed.status, 409);
  assert.strictEqual((await candidates(route.id)).route.pendingTrucks, 0, "有一筆錯誤時,另一筆也不能被寫入");

  const sent = await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }, { fleetId: b.id, requestedTrucks: 2 }] }, ops);
  assert.strictEqual(sent.status, 200);
  assert.strictEqual(sent.data.route.pendingTrucks, 4);
  assert.strictEqual(sent.data.route.confirmedTrucks, 0);
  assert.strictEqual(sent.data.route.shortage, 4);
  assert.strictEqual(sent.data.route.status, "待車隊回覆");

  const cs = (await candidates(route.id)).candidates;
  const asgA = cs.find((x) => x.fleetId === a.id).assignmentId;
  const asgB = cs.find((x) => x.fleetId === b.id).assignmentId;

  assert.strictEqual((await api("PATCH", `/api/shopee/assignments/${asgA}`, { confirmedTrucks: 3 })).status, 400, "不能承接超過被要求的車數");
  assert.strictEqual((await api("PATCH", `/api/shopee/assignments/${asgA}`, { confirmedTrucks: -1 })).status, 400);
  assert.strictEqual((await api("PATCH", `/api/shopee/assignments/${asgA}`, { confirmedTrucks: "" })).status, 400);

  const r1 = await api("PATCH", `/api/shopee/assignments/${asgA}`, { confirmedTrucks: 2 }, ops);
  assert.strictEqual(r1.data.route.confirmedTrucks, 2);
  assert.strictEqual(r1.data.route.shortage, 2);
  assert.strictEqual(r1.data.route.status, "待車隊回覆");

  const r2 = await api("PATCH", `/api/shopee/assignments/${asgB}`, { confirmedTrucks: 1 });
  assert.strictEqual(r2.data.route.confirmedTrucks, 3);
  assert.strictEqual(r2.data.route.shortage, 1);
  assert.strictEqual(r2.data.route.status, "待分派", "已全部回覆但仍有缺口,應回到待分派");

  // B 的要求車數從 2 改成 1:B 先前的回覆作廢、需重新確認;A 不受影響
  const resized = await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: b.id, requestedTrucks: 1 }] });
  assert.strictEqual(resized.data.route.confirmedTrucks, 2, "只剩 A 的 2 車是已確認");
  assert.strictEqual(resized.data.route.pendingTrucks, 1, "B 變回待回覆");
  // 要求車數沒變(A 2→2):保留既有回覆
  const same = await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }] });
  assert.strictEqual(same.data.route.confirmedTrucks, 2);
  // 再把 B 調回 2 車並確認 → 補滿
  await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: b.id, requestedTrucks: 2 }] });

  const done = await api("PATCH", `/api/shopee/assignments/${asgB}`, { confirmedTrucks: 2 });
  assert.strictEqual(done.data.route.shortage, 0);
  assert.strictEqual(done.data.route.status, "已補滿");

  const declined = await api("PATCH", `/api/shopee/assignments/${asgB}`, { confirmedTrucks: 0 });
  assert.strictEqual(declined.data.route.status, "待分派");
  const reset = await api("PATCH", `/api/shopee/assignments/${asgB}`, { reset: true });
  assert.strictEqual(reset.data.route.pendingTrucks, 2);
  assert.strictEqual(reset.data.route.status, "待車隊回覆");

  const removed = await api("DELETE", `/api/shopee/assignments/${asgB}`);
  assert.strictEqual(removed.data.route.pendingTrucks, 0);
  assert.strictEqual((await api("DELETE", `/api/shopee/assignments/${asgB}`)).status, 404);
  assert.strictEqual((await api("PATCH", "/api/shopee/assignments/999999", { confirmedTrucks: 1 })).status, 404);
});

test("over-confirmation never produces negative shortage", async () => {
  const a = await newFleet("超額A"); await newCap(a.id, "甲", "乙", "11T", 5);
  const b = await newFleet("超額B"); await newCap(b.id, "甲", "乙", "11T", 5);
  const route = await newRoute("甲", "乙", "11T", 2, "2026-10-11");
  await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }, { fleetId: b.id, requestedTrucks: 2 }] });
  for (const c of (await candidates(route.id)).candidates) await api("PATCH", `/api/shopee/assignments/${c.assignmentId}`, { confirmedTrucks: 2 });
  const r = (await api("GET", `/api/shopee/routes?date=2026-10-11`)).data.find((x) => x.id === route.id);
  assert.strictEqual(r.confirmedTrucks, 4);
  assert.strictEqual(r.shortage, 0);
  assert.strictEqual(r.status, "已補滿");
});

test("daily fleet capacity is shared across routes on the same day (and freed when declined)", async () => {
  const f = await newFleet("單日上限車隊", { dailyCapacity: 3 });
  await newCap(f.id, "地1", "地2", "3.5T", 3);
  await newCap(f.id, "地3", "地4", "3.5T", 3);
  const r1 = await newRoute("地1", "地2", "3.5T", 3, "2026-10-12");
  const r2 = await newRoute("地3", "地4", "3.5T", 3, "2026-10-12");
  const r3 = await newRoute("地3", "地4", "3.5T", 3, "2026-10-13"); // 不同天,不受影響

  const first = await api("PUT", `/api/shopee/routes/${r1.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 2 }] });
  assert.strictEqual(first.status, 200);

  const over = await api("PUT", `/api/shopee/routes/${r2.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 2 }] });
  assert.strictEqual(over.status, 409);
  assert.match(over.data.details[0], /當天上限 3 車/);

  const c = (await candidates(r2.id)).candidates[0];
  assert.strictEqual(c.usedOnOtherRoutes, 2);
  assert.strictEqual(c.availableTrucks, 1);

  assert.strictEqual((await api("PUT", `/api/shopee/routes/${r2.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 1 }] })).status, 200);
  assert.strictEqual((await api("PUT", `/api/shopee/routes/${r3.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 3 }] })).status, 200);

  // 拒絕後釋出名額
  const asg = (await candidates(r1.id)).candidates[0].assignmentId;
  await api("PATCH", `/api/shopee/assignments/${asg}`, { confirmedTrucks: 0 });
  assert.strictEqual((await candidates(r2.id)).candidates[0].usedOnOtherRoutes, 0);
});

test("auto-assign: fills the gap, largest capacity first, respects daily capacity, leaves status pending", async () => {
  const big = await newFleet("自動-大"); await newCap(big.id, "自A", "自B", "17T", 3);
  const mid = await newFleet("自動-中"); await newCap(mid.id, "自A", "自B", "17T", 2);
  const tiny = await newFleet("自動-小"); await newCap(tiny.id, "自A", "自B", "17T", 1);
  const limited = await newFleet("自動-被限制", { dailyCapacity: 1 }); await newCap(limited.id, "自A", "自B", "17T", 5);
  await newCap(limited.id, "自C", "自D", "17T", 5);
  const other = await newRoute("自C", "自D", "17T", 1, "2026-10-14");
  await api("PUT", `/api/shopee/routes/${other.id}/assignments`, { assignments: [{ fleetId: limited.id, requestedTrucks: 1 }] });

  const route = await newRoute("自A", "自B", "17T", 6, "2026-10-14");
  const res = await api("POST", `/api/shopee/routes/${route.id}/auto-assign`, undefined, ops);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(
    res.data.created.map((c) => [c.name, c.requestedTrucks]),
    [["自動-大", 3], ["自動-中", 2], ["自動-小", 1]]
  );
  assert.strictEqual(res.data.uncovered, 0);
  assert.strictEqual(res.data.route.pendingTrucks, 6);
  assert.strictEqual(res.data.route.confirmedTrucks, 0);
  assert.ok(!res.data.created.some((c) => c.name === "自動-被限制"), "當天額度已用完的車隊不該被分派");

  const again = await api("POST", `/api/shopee/routes/${route.id}/auto-assign`);
  assert.deepStrictEqual(again.data.created, []);
  assert.match(again.data.message, /不需再分派/);

  // 候選車隊不足時,回報還缺多少
  const short = await newRoute("自A", "自B", "17T", 10, "2026-10-15");
  const partial = await api("POST", `/api/shopee/routes/${short.id}/auto-assign`);
  assert.ok(partial.data.uncovered > 0);
  assert.strictEqual(partial.data.created.reduce((n, c) => n + c.requestedTrucks, 0) + partial.data.uncovered, 10);

  assert.strictEqual((await api("POST", "/api/shopee/routes/NOPE/auto-assign")).status, 404);
});

test("editing a demand: truck count/note free; date/route/type locked once fleets are assigned", async () => {
  const f = await newFleet("編輯鎖定車隊"); await newCap(f.id, "編1", "編2", "11T", 3);
  const route = await newRoute("編1", "編2", "11T", 2, "2026-10-16");

  const free = await api("PATCH", `/api/shopee/routes/${route.id}`, { origin: "編1", destination: "編3", requiredTrucks: 3, note: "加班" });
  assert.strictEqual(free.status, 200);
  assert.strictEqual(free.data.routeName, "編1→編3");
  await api("PATCH", `/api/shopee/routes/${route.id}`, { destination: "編2" });

  await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 1 }] });
  assert.strictEqual((await api("PATCH", `/api/shopee/routes/${route.id}`, { destination: "編9" })).status, 409);
  assert.strictEqual((await api("PATCH", `/api/shopee/routes/${route.id}`, { serviceDate: "2026-10-20" })).status, 409);
  const ok = await api("PATCH", `/api/shopee/routes/${route.id}`, { requiredTrucks: 5, note: "改車數" });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.requiredTrucks, 5);
  assert.strictEqual((await api("PATCH", "/api/shopee/routes/NOPE", { requiredTrucks: 1 })).status, 404);
  assert.strictEqual((await api("PATCH", `/api/shopee/routes/${route.id}`, { requiredTrucks: 0 })).status, 400);
});

test("fleet with assignment history cannot be deleted; deleting a demand cascades its assignments", async () => {
  const f = await newFleet("有紀錄車隊"); await newCap(f.id, "刪1", "刪2", "17T", 2);
  const route = await newRoute("刪1", "刪2", "17T", 1, "2026-10-17");
  await api("PUT", `/api/shopee/routes/${route.id}/assignments`, { assignments: [{ fleetId: f.id, requestedTrucks: 1 }] });

  const blocked = await api("DELETE", `/api/shopee/fleets/${f.id}`);
  assert.strictEqual(blocked.status, 409);

  assert.strictEqual((await api("DELETE", `/api/shopee/routes/${route.id}`, undefined, ops)).status, 403);
  assert.strictEqual((await api("DELETE", `/api/shopee/routes/${route.id}`)).status, 204);
  const left = await pool.query("SELECT 1 FROM shopee_assignments WHERE route_id = $1", [route.id]);
  assert.strictEqual(left.rows.length, 0);
  assert.strictEqual((await api("DELETE", `/api/shopee/fleets/${f.id}`)).status, 204);
});

test("CSV import: valid batch inserted; any bad row rejects everything with row numbers", async () => {
  const before = (await api("GET", "/api/shopee/routes?date=2026-11-01")).data.length;
  const bad = await api("POST", "/api/shopee/routes/import", {
    rows: [
      { serviceDate: "2026-11-01", origin: "匯1", destination: "匯2", vehicleType: "3.5T", requiredTrucks: "2" },
      { serviceDate: "2026-11-31", origin: "", destination: "匯2", vehicleType: "88T", requiredTrucks: "x" },
    ],
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.data.details[0].row, 2);
  assert.ok(bad.data.details[0].problems.length >= 4);
  assert.strictEqual((await api("GET", "/api/shopee/routes?date=2026-11-01")).data.length, before);

  assert.strictEqual((await api("POST", "/api/shopee/routes/import", { rows: [] })).status, 400);
  assert.strictEqual((await api("POST", "/api/shopee/routes/import", {})).status, 400);

  const ok = await api("POST", "/api/shopee/routes/import", {
    rows: [
      { serviceDate: "2026-11-01", origin: "匯1", destination: "匯2", vehicleType: "3.5T", requiredTrucks: "2", note: "a" },
      { serviceDate: "2026-11-01", origin: "匯2", destination: "匯3", vehicleType: "11T", requiredTrucks: 1 },
    ],
  }, ops);
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.data.imported, 2);
  assert.strictEqual((await api("GET", "/api/shopee/routes?date=2026-11-01")).data.length, before + 2);
});

test("date filter validated; list is ordered; audit log records who did what (no secrets)", async () => {
  assert.strictEqual((await api("GET", "/api/shopee/routes?date=abc")).status, 400);
  const all = (await api("GET", "/api/shopee/routes")).data;
  const dates = all.map((r) => r.serviceDate);
  assert.deepStrictEqual(dates, [...dates].sort());

  const logs = (await api("GET", "/api/audit-logs?limit=500")).data;
  const kinds = new Set(logs.map((l) => `${l.action}:${l.entity}`));
  for (const k of ["新增:蝦皮需求", "批次匯入:蝦皮需求", "新增:蝦皮車隊", "新增:蝦皮車隊路線", "發送需求:蝦皮承接", "確認承接:蝦皮承接", "自動分派:蝦皮承接", "拒絕承接:蝦皮承接"]) {
    assert.ok(kinds.has(k), `缺少操作紀錄:${k}`);
  }
});

test("fleet LINE link: only official https LINE URLs are accepted (it becomes a clickable link, so this is a security boundary)", async () => {
  const good = [
    "https://line.me/ti/g/AbC123",
    "https://line.me/R/ti/p/@abc",
    "https://page.line.me/xyz",
    "https://lin.ee/AbCdEf",
    "https://liff.line.me/123-abc",
    "  https://lin.ee/trimmed  ",
  ];
  for (let i = 0; i < good.length; i++) {
    const r = await api("POST", "/api/shopee/fleets", { name: `LINK-OK-${i}`, lineLink: good[i] });
    assert.strictEqual(r.status, 201, `應接受:${good[i]} → ${JSON.stringify(r.data)}`);
    assert.strictEqual(r.data.lineLink, good[i].trim());
  }

  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "http://line.me/ti/g/x",            // 非 https
    "https://evil.com/line.me",         // 路徑裡有 line.me
    "https://line.me.evil.com/x",       // 仿冒子網域
    "https://notline.me/x",
    "https://xline.me/x",
    "https://evil.com/?u=https://line.me/x",
    "https://user:pw@line.me/x",        // 帶帳密
    "https://line.me:8443/x",           // 非標準 port
    "line://ti/g/abc",
    "ftp://line.me/x",
    "data:text/html,<script>alert(1)</script>",
    "//line.me/x",
    "not a url",
    "https://line.me/" + "a".repeat(300),
  ];
  for (let i = 0; i < bad.length; i++) {
    const r = await api("POST", "/api/shopee/fleets", { name: `LINK-BAD-${i}`, lineLink: bad[i] });
    assert.strictEqual(r.status, 400, `應拒絕:${bad[i].slice(0, 60)}(實際 ${r.status})`);
  }
  const all = (await api("GET", "/api/shopee/fleets")).data;
  assert.ok(!all.some((f) => f.name.startsWith("LINK-BAD-")), "被拒絕的不能留下任何資料");
});

test("fleet LINE link: set, change, clear via edit; invalid edit leaves the old value; shown in list and candidates", async () => {
  const f = await newFleet("連結編輯車隊");
  assert.strictEqual(f.lineLink, "", "沒填就是空字串");

  const set = await api("PATCH", `/api/shopee/fleets/${f.id}`, { lineLink: "https://line.me/ti/g/first" }, ops);
  assert.strictEqual(set.data.lineLink, "https://line.me/ti/g/first");

  const badEdit = await api("PATCH", `/api/shopee/fleets/${f.id}`, { lineLink: "javascript:alert(1)" });
  assert.strictEqual(badEdit.status, 400);
  const unchanged = (await api("GET", "/api/shopee/fleets")).data.find((x) => x.id === f.id);
  assert.strictEqual(unchanged.lineLink, "https://line.me/ti/g/first", "編輯失敗不能動到原本的連結");

  const other = await api("PATCH", `/api/shopee/fleets/${f.id}`, { phone: "0999" });
  assert.strictEqual(other.data.lineLink, "https://line.me/ti/g/first", "只改別的欄位時連結要保留");

  await newCap(f.id, "連1", "連2", "11T", 2);
  const route = await newRoute("連1", "連2", "11T", 1, "2026-10-20");
  const cand = (await candidates(route.id)).candidates.find((c) => c.fleetId === f.id);
  assert.strictEqual(cand.lineLink, "https://line.me/ti/g/first");

  const cleared = await api("PATCH", `/api/shopee/fleets/${f.id}`, { lineLink: "" });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.data.lineLink, "");
});

test("fleet tasks: lists only that fleet's assignments with route info, filterable by date, ordered by date", async () => {
  const a = await newFleet("任務A車隊", { lineLink: "https://lin.ee/taskA" });
  const b = await newFleet("任務B車隊");
  await newCap(a.id, "任1", "任2", "3.5T", 5);
  await newCap(a.id, "任3", "任4", "17T", 5);
  await newCap(b.id, "任1", "任2", "3.5T", 5);

  const late = await newRoute("任3", "任4", "17T", 2, "2026-10-22");
  const early = await newRoute("任1", "任2", "3.5T", 3, "2026-10-21");
  await api("PUT", `/api/shopee/routes/${late.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }] });
  await api("PUT", `/api/shopee/routes/${early.id}/assignments`, { assignments: [{ fleetId: a.id, requestedTrucks: 2 }, { fleetId: b.id, requestedTrucks: 1 }] });
  const asgA = (await candidates(early.id)).candidates.find((c) => c.fleetId === a.id).assignmentId;
  await api("PATCH", `/api/shopee/assignments/${asgA}`, { confirmedTrucks: 1 });

  const r = await api("GET", `/api/shopee/fleets/${a.id}/tasks`, undefined, ops);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.fleet, { id: a.id, name: "任務A車隊", lineLink: "https://lin.ee/taskA" });
  assert.deepStrictEqual(r.data.tasks.map((t) => t.serviceDate), ["2026-10-21", "2026-10-22"], "依日期排序");
  const first = r.data.tasks[0];
  assert.deepStrictEqual(
    [first.origin, first.destination, first.vehicleType, first.requestedTrucks, first.confirmedTrucks, first.status],
    ["任1", "任2", "3.5T", 2, 1, "已確認"]
  );
  assert.ok(r.data.tasks.every((t) => t.routeId !== undefined && t.assignmentId !== undefined));

  const filtered = await api("GET", `/api/shopee/fleets/${a.id}/tasks?date=2026-10-22`);
  assert.strictEqual(filtered.data.tasks.length, 1);
  assert.strictEqual(filtered.data.tasks[0].origin, "任3");

  const bTasks = (await api("GET", `/api/shopee/fleets/${b.id}/tasks`)).data.tasks;
  assert.strictEqual(bTasks.length, 1, "B 看不到 A 的任務");
  assert.strictEqual(bTasks[0].requestedTrucks, 1);

  assert.strictEqual((await api("GET", `/api/shopee/fleets/${a.id}/tasks?date=abc`)).status, 400);
  assert.strictEqual((await api("GET", "/api/shopee/fleets/NOPE/tasks")).status, 404);
  assert.strictEqual((await call("GET", `/api/shopee/fleets/${a.id}/tasks`, {})).status, 401);
});
