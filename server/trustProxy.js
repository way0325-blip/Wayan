// 決定 Express 要信任幾層反向代理(trust proxy)。
//
// 為什麼重要:部署在 Render 這類平台時,前面有一層代理(負載平衡器),它會把用戶的真實 IP 放進
// X-Forwarded-For。如果 Express 不信任代理,req.ip 永遠是代理自己的位址,速率限制就會把
// 「所有人」當成同一個人:10 次登入失敗就全站被鎖、300 次 API 呼叫全站共用。
//
// 只信任「一層」而不是全部(true):用戶自己偽造的 X-Forwarded-For 前綴會被忽略,不能拿來繞過限流。
//
// 規則:環境變數 TRUST_PROXY 若是 0 以上的整數就照用;沒設定時,在 Render 上(有 RENDER 環境變數)用 1,
// 其他環境(本機、docker-compose 直連)用 0,避免沒有代理時被偽造標頭影響。
function resolveTrustProxy(env = process.env, warn = console.warn) {
  const fallback = env.RENDER ? 1 : 0;
  const raw = env.TRUST_PROXY;
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) return Number(value);
  warn(`TRUST_PROXY 必須是 0 以上的整數(代理層數),收到 "${raw}",改用預設值 ${fallback}`);
  return fallback;
}

module.exports = { resolveTrustProxy };
