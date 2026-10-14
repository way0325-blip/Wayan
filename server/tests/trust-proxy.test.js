const test = require("node:test");
const assert = require("node:assert");

// 模擬「放在 Render 代理後面」:在載入 app 之前就設好
process.env.TRUST_PROXY = "1";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "1234";

const { resolveTrustProxy } = require("../trustProxy");
const { pool, initDb } = require("../db");

test("resolveTrustProxy: explicit integer wins, Render defaults to 1, elsewhere 0, garbage falls back", () => {
  const quiet = () => {};
  assert.strictEqual(resolveTrustProxy({}, quiet), 0, "本機/直連預設不信任代理");
  assert.strictEqual(resolveTrustProxy({ RENDER: "true" }, quiet), 1, "在 Render 上自動信任一層");
  assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: "2" }, quiet), 2);
  assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: "0", RENDER: "true" }, quiet), 0, "明確設 0 優先");
  assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: " 1 " }, quiet), 1);
  assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: "" , RENDER: "true" }, quiet), 1);

  const warnings = [];
  const warn = (m) => warnings.push(m);
  for (const bad of ["abc", "-1", "1.5", "true"]) {
    assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: bad, RENDER: "true" }, warn), 1, `無效值 ${bad} 要退回預設`);
    assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: bad }, warn), 0);
  }
  assert.strictEqual(warnings.length, 8, "無效值要有警告,避免默默用錯設定");
});

test("behind a proxy, rate limits are per real client IP: one client's failed logins do not lock out everyone else", async () => {
  await pool.query("DROP TABLE IF EXISTS users CASCADE");
  await initDb();
  const app = require("../index");
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = async (ip, password = "wrong") => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ username: "admin", password }),
    });
    return res.status;
  };

  try {
    const attacker = "203.0.113.10";
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push(await login(attacker));
    assert.deepStrictEqual(statuses.slice(0, 10), Array(10).fill(401), "前 10 次是帳密錯誤");
    assert.deepStrictEqual(statuses.slice(10), [429, 429], "第 11 次起被限流");

    // 這是修正前會出問題的地方:另一個用戶(不同 IP)不該被連累
    assert.strictEqual(await login("203.0.113.20"), 401, "別的用戶不受影響(仍是帳密錯誤,不是 429)");
    assert.strictEqual(await login("203.0.113.30", "1234"), 200, "別的用戶可以正常登入");

    // 偽造 X-Forwarded-For 前綴不能繞過限流:只信任代理附加的那一層
    assert.strictEqual(await login(`9.9.9.9, ${attacker}`), 429, "在前面塞假 IP 仍然算同一個人");
    assert.strictEqual(await login(`1.2.3.4, 5.6.7.8, ${attacker}`), 429);
  } finally {
    server.close();
    await pool.end();
  }
});
