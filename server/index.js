require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const driverRoutes = require("./routes/drivers");
const vehicleRoutes = require("./routes/vehicles");
const orderRoutes = require("./routes/orders");
const settingsRoutes = require("./routes/settings");
const auditLogRoutes = require("./routes/auditLogs");

const app = express();
const PORT = process.env.PORT || 3000;

// 安全性 headers。放寬 CSP 讓前端的內嵌 <script>/<style> 仍可運作
// (public/index.html 是單一檔案的簡易前端,尚未拆成外部檔案)。
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  })
);

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.use(express.json({ limit: "100kb" }));

// 全站 API 速率限制,避免暴力嘗試或濫用
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// 登入端點更嚴格的限制,避免密碼暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "登入嘗試次數過多,請 15 分鐘後再試" },
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", loginLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/audit-logs", auditLogRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 提供前端靜態檔案
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "伺服器發生錯誤" });
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`港區星際運輸調度中心伺服器已啟動: http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("伺服器啟動失敗:", err);
    process.exit(1);
  });
}

module.exports = app;
