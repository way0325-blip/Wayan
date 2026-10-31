const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { pool, initDb } = require("../db");
const app = require("../index");
let server, base, admin, dispatcher;

async function request(method, path, auth, body) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(auth ? { Authorization: "Bearer " + auth } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
async function login(username, password) {
  const r = await request("POST", "/api/auth/login", null, { username, password });
  assert.equal(r.status, 200);
  return r.data.token;
}

test.before(async () => {
  await initDb();
  await pool.query("TRUNCATE shopee_violation_fines, shopee_violation_appeals, shopee_violation_case_events, shopee_violation_cases, shopee_violation_rules, shopee_violation_rule_versions RESTART IDENTITY CASCADE");
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  base = "http://127.0.0.1:" + server.address().port;
  admin = await login("admin", "1234");
  const created = await request("POST", "/api/users", admin, { username: "violation_ops", password: "pass1234", role: "dispatcher" });
  assert.equal(created.status, 201);
  dispatcher = await login("violation_ops", "pass1234");
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test("violation rules, cases, review, appeals and manual fines enforce workflow", async () => {
  assert.equal((await request("GET", "/api/shopee/violations/cases", null)).status, 401);

  const version = await request("POST", "/api/shopee/violations/versions", admin, {
    version_name: "test-version", source_document: "測試規範.pdf", effective_date: "2026-01-01",
  });
  assert.equal(version.status, 201);

  const rule = await request("POST", "/api/shopee/violations/rules", admin, {
    version_id: version.data.id, rule_code: "TEST-001", category: "門市作業規範",
    rule_text: "測試條款原文", source_page: 1, applicable_to: "合作車隊",
  });
  assert.equal(rule.status, 201);
  assert.equal(rule.data.verification_status, "待核對");

  const invalidCase = await request("POST", "/api/shopee/violations/cases", dispatcher, {
    fleet_id: "TEST-FLEET", rule_id: rule.data.id, event_at: "2026-02-01T09:00:00Z", description: "測試事件",
  });
  assert.equal(invalidCase.status, 400);

  assert.equal((await request("PATCH", "/api/shopee/violations/rules/" + rule.data.id + "/verify", dispatcher, { verification_status: "已核對" })).status, 403);
  assert.equal((await request("PATCH", "/api/shopee/violations/rules/" + rule.data.id + "/verify", admin, { verification_status: "已核對" })).status, 200);
  assert.equal((await request("POST", "/api/shopee/violations/versions/" + version.data.id + "/approve", admin, {})).status, 200);

  const fleet = await pool.query("SELECT id FROM partner_fleets ORDER BY id LIMIT 1");
  const createdCase = await request("POST", "/api/shopee/violations/cases", dispatcher, {
    fleet_id: fleet.rows[0].id, rule_id: rule.data.id, event_at: "2026-02-01T09:00:00Z",
    description: "測試違規事件", evidence_note: "證據已由主管留存",
  });
  assert.equal(createdCase.status, 201);
  assert.equal(createdCase.data.status, "待主管覆核");

  assert.equal((await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/review", dispatcher, { decision: "全責", reason: "測試" })).status, 403);
  assert.equal((await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/review", admin, { decision: "全責", reason: "" })).status, 400);
  assert.equal((await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/fines", admin, {
    payer_type: "我方", amount: 1000, source_reference: "TEST-FINE-001",
  })).status, 409);

  const reviewed = await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/review", admin, {
    decision: "全責", reason: "經核對證據，確認責任成立",
  });
  assert.equal(reviewed.status, 200);

  const appeal = await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/appeals", dispatcher, {
    appeal_text: "提出測試申訴",
  });
  assert.equal(appeal.status, 201);
  assert.equal((await request("PATCH", "/api/shopee/violations/appeals/" + appeal.data.id + "/decision", dispatcher, {
    status: "不成立", decision_reason: "測試",
  })).status, 403);
  assert.equal((await request("PATCH", "/api/shopee/violations/appeals/" + appeal.data.id + "/decision", admin, {
    status: "不成立", decision_reason: "經查證不成立",
  })).status, 200);

  const fine = await request("POST", "/api/shopee/violations/cases/" + createdCase.data.id + "/fines", admin, {
    payer_type: "合作車隊", amount: 1000, source_reference: "TEST-FINE-001",
  });
  assert.equal(fine.status, 201);
  assert.equal(fine.data.status, "待人工確認");
  assert.equal((await request("PATCH", "/api/shopee/violations/fines/" + fine.data.id + "/confirm", admin, {
    status: "已確認", note: "人工核對完成",
  })).status, 200);

  const events = await request("GET", "/api/shopee/violations/cases/" + createdCase.data.id + "/events", dispatcher);
  assert.equal(events.status, 200);
  assert.ok(events.data.length >= 5);
  assert.equal((await request("DELETE", "/api/shopee/violations/cases/" + createdCase.data.id, admin)).status, 404);
});
