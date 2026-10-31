// This development branch is deliberately unable to open a production database.
function assertStagingDatabase(env = process.env, destructive = false) {
  let url;
  try { url = new URL(destructive ? env.TEST_DATABASE_URL : env.DATABASE_URL); }
  catch { throw new Error("必須明確設定獨立的 wayan-staging-db 連線"); }
  if (env.WAYAN_ENV !== "staging" || !["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.pathname) !== "/wayan-staging-db" || url.searchParams.has("options")) {
    throw new Error("安全限制：本分支只允許 WAYAN_ENV=staging 與 wayan-staging-db");
  }
  if (destructive && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || env.ALLOW_STAGING_TEST_RESET !== "yes")) {
    throw new Error("測試清除僅允許明確授權的本機 wayan-staging-db");
  }
  return url;
}
module.exports = { assertStagingDatabase };
