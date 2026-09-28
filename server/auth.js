const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "缺少 JWT_SECRET 環境變數。請複製 .env.example 為 .env 並設定一組隨機長字串。"
  );
}

function generateToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "未登入或憑證遺失" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "登入已過期,請重新登入" });
  }

  try {
    // 每次都以資料庫為準:帳號被停用或角色被調整時,立即生效,不必等 token 過期
    const { rows } = await pool.query(
      "SELECT id, username, role, active FROM users WHERE id = $1",
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: "帳號已停用或不存在" });
    }
    req.user = { sub: user.id, username: user.username, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

// 用法: requireRole("admin") 或 requireRole("admin", "dispatcher")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "權限不足,此操作僅限:" + roles.join("、") });
    }
    next();
  };
}

module.exports = { generateToken, requireAuth, requireRole };
