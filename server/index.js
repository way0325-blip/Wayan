require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db");
const { resolveTrustProxy } = require("./trustProxy");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const driverRoutes = require("./routes/drivers");
const vehicleRoutes = require("./routes/vehicles");
const orderRoutes = require("./routes/orders");
const settingsRoutes = require("./routes/settings");
const auditLogRoutes = require("./routes/auditLogs");
const lineWebhookRoutes = require("./routes/secureLineWebhook");
const lineCronRoutes = require("./routes/lineCron");
const alertRoutes = require("./routes/alerts");
const vehicleMaintenanceItemRoutes = require("./routes/vehicleMaintenanceItems");
const dispatchStaffRoutes = require("./routes/dispatchStaff");
const attendanceRoutes = require("./routes/attendance");
const shopeeRoutes = require("./routes/shopee");

const app = express();

// 讓速率限制看到的是用戶真實 IP,而不是 Render 代理的 IP(詳見 server/trustProxy.js)
app.set("trust proxy", resolveTrustProxy());
const PORT = process.env.PORT || 3000;
const freePreview = process.env.WAYAN_FREE_PREVIEW === 'yes';

// 安全性 headers。放寬 CSP 讓前端的內嵌 <script>/<style> 仍可運作
// (public/index.html 是單一檔案的簡易前端,尚未拆成外部檔案)。
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // Helmet 的預設 CSP 會自動補上 script-src-attr 'none',擋掉所有 onclick="..." 這類
        // inline 事件屬性(除非這裡明確覆寫)。前端大量使用 onclick/onchange,少了這行會導致
        // 幾乎所有按鈕在真實瀏覽器裡點了沒反應(jsdom 等測試工具不會強制 CSP,所以測試測不出來)。
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameSrc: ["'self'", "https://www.openstreetmap.org"],
      },
    },
  })
);

// LINE webhook 一定要在 express.json() 之前掛載:它需要驗證「原始」的請求內容(簽章比對),
// 一旦被 express.json() 解析過,原始 body 就拿不回來了。這個路由不需要 CORS、也不用一般 API 限流
// (呼叫方是 LINE 的伺服器,不是瀏覽器)。
if (!freePreview) app.use("/api/line", lineWebhookRoutes);

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.use('/api/excel',express.json({limit:'6mb'}));
app.use('/api/store-delivery',express.json({limit:'2mb'}));
app.use('/api/source-catalog',express.json({limit:'3mb'}));
app.use('/api/pickup-routes',express.json({limit:'3mb'}));
app.use('/api/route-carriers',express.json({limit:'3mb'}));
app.use(express.json({ limit: "100kb" }));

// 全站 API 速率限制,避免暴力嘗試或濫用
const apiLimiter = rateLimit({
  skip: req => req.method === 'GET' && req.path.startsWith('/control/'),
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message:{error:'操作過於頻繁，請稍後重試'},
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

const readApiLimiter=rateLimit({
  skip:req=>req.path.startsWith('/control/'),windowMs:15*60*1000,limit:600,
  standardHeaders:true,legacyHeaders:false,message:{error:'查詢過於頻繁，請稍後再更新'},
});
app.use('/api',(req,res,next)=>req.method==='GET'?readApiLimiter(req,res,next):apiLimiter(req,res,next));
app.use("/api/auth/login", loginLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/audit-logs", auditLogRoutes);
if (!freePreview) app.use("/api/line/cron", lineCronRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/vehicle-maintenance-items", vehicleMaintenanceItemRoutes);
app.use("/api/dispatch-staff", dispatchStaffRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/shopee", shopeeRoutes);
app.use("/api/control", require("./routes/control"));
app.use("/api/line/admin", require("./routes/lineAdmin"));
app.use('/api/fleet-ops',require('./routes/fleetOps'));
app.use('/api/penalty-rules',require('./routes/penaltyRules'));
app.use('/api/penalty-cases',require('./routes/penaltyCases'));
app.use('/api/store-delivery',require('./routes/storeDelivery'));
app.use('/api/shopee-live',require('./routes/shopeeLive'));
app.use('/api/google-sources',require('./routes/googleSources'));
app.use('/api/excel',require('./routes/excelFiles'));
app.use('/api/source-catalog',require('./routes/sourceCatalog'));
app.use('/api/pickup-routes',require('./routes/pickupRoutes'));
app.use('/api/operation-sources',require('./routes/operationSources'));
app.use('/api/weekly-staffing',require('./routes/weeklyStaffing'));
app.use('/api/route-settings',require('./routes/routeSettings'));
app.use('/api/platform-sheets',require('./routes/platformSheets'));
app.use('/api/route-carriers',require('./routes/carrierMappings'));
app.use('/api/weekly-routes',require('./routes/weeklyRoutes'));
app.use('/api/driver-routes',require('./routes/driverRoutes'));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use('/api', (req,res)=>res.status(404).json({error:'找不到 API'}));

// 提供前端靜態檔案
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({error:'JSON 格式錯誤'});
  if (err.type === 'entity.too.large') return res.status(413).json({error:'請求內容過大'});
  console.error('API_ERROR', err.code || err.name);
  res.status(500).json({ error: "伺服器發生錯誤" });
});

async function start() {
  if ((process.env.JWT_SECRET || '').length < 32 || (process.env.ADMIN_PASSWORD || '').length < 12) {
    throw new Error('測試平台啟動需要獨立的 JWT_SECRET（至少 32 字）及 ADMIN_PASSWORD（至少 12 字），禁止沿用展示密碼');
  }
  await initDb();
  if (freePreview) {
    if(process.env.WAYAN_FREE_SOURCE_SYNC==='yes'){for(const reader of ['routeSourceRefresh','staffingSync','hourlyTasks','personnelSources'])require('./'+reader).start();require('./googleSourceOAuth').status().then(async s=>{console.log('READ_ONLY_GOOGLE_SOURCE_STATUS',JSON.stringify({keyReady:s.keyReady,clientReady:s.clientReady,connected:s.connected,driveReady:s.driveReady}));if(s.connected)await require('./routeSourceRefresh').refresh();}).catch(e=>console.error('READ_ONLY_INITIAL_SYNC_FAILED',e.code||e.status||'SOURCE_READ_FAILED'));}
    app.listen(PORT, () => console.log(`Wayan 獨立驗收環境已啟動，連接埠 ${PORT}`));
    return;
  }
  try{const c=await require('./googleSourceOAuth').status();console.log('GOOGLE_SOURCE_CONFIG_STATUS',JSON.stringify({keyReady:c.keyReady,clientReady:c.clientReady,configurationSource:c.configurationSource,connected:c.connected}));}catch{console.error('GOOGLE_SOURCE_CONFIG_STATUS_FAILED');}
  try {const demo=await require('./stagingDemoOrders').setupStagingDemo(require('./db').pool);if(demo.status!=='disabled')console.log('STAGING_DEMO_ORDERS',JSON.stringify(demo));}catch(err){console.error('STAGING_DEMO_ORDERS_FAILED',err.code||'SETUP_FAILED');}
  try {
    const setup=await require('./stagingFleetBootstrap').setupStagingFleet(require('./db').pool);
    if(setup.status!=='disabled')console.log('STAGING_FLEET_SETUP',JSON.stringify(setup));
  } catch(err) { console.error('STAGING_FLEET_SETUP_FAILED',err.code||'SETUP_FAILED'); }
  try{const checkins=await require('./stagingCheckinSetup').setupStagingCheckins(require('./db').pool);if(checkins.status!=='disabled')console.log('STAGING_CHECKIN_SETUP',JSON.stringify(checkins));}catch(err){console.error('STAGING_CHECKIN_SETUP_FAILED',err.aliasError||err.dispatchStatus?err.message:(err.code||err.name||'SETUP_FAILED'));}
  try{const result=await require('./stagingRouteAcceptance').setup(require('./db').pool);if(result.status!=='disabled')console.log('STAGING_ROUTE_ACCEPTANCE',JSON.stringify(result));}catch(e){console.error('STAGING_ROUTE_ACCEPTANCE_FAILED',e.code||'SETUP_FAILED');}
  require('./fleetJobs').startFleetWorker();
  require('./platformSheets').start();
  require('./routeSheets').start();
  require('./routeSourceRefresh').start();
  require('./staffingSync').start();
  require('./hourlyTasks').start();
  require('./personnelSources').start();
  app.listen(PORT, () => {
    console.log(`港區星際運輸調度中心伺服器已啟動: http://localhost:${PORT}`);
    require('./sourceCatalogBootstrap').bootstrapSourceCatalog(require('./db').pool)
      .then(async result=>{if(process.env.WAYAN_ENV==='staging'){try{await require('./routeSourceRefresh').refresh();}catch(e){console.error('ROUTE_SOURCE_REFRESH_FAILED',e.code||e.status||'SOURCE_READ_FAILED');}try{await require('./realFleetRegistry').sync();}catch(e){console.error('REAL_FLEET_REGISTRY_FAILED',e.code||'REGISTRY_FAILED');}}if(result.length)console.log('SOURCE_CATALOG_INITIAL_IMPORT',JSON.stringify(result));if(process.env.WAYAN_ENV==='staging'){await require('./rosterSheets').ensureInitial();require('./rosterSheets').startPolling();await require('./fleetOperations').enqueueSheet(require('./db').pool,'attendance','current');require('./attendanceSheets').start();}})
      .catch(()=>console.error('SOURCE_CATALOG_INITIAL_IMPORT_FAILED'));
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("伺服器啟動失敗:", err);
    process.exit(1);
  });
}

module.exports = app;
