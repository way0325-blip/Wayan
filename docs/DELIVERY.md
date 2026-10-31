# Wayan 個人控制平台與 LINE Bot：測試版交付

日期：2026-10-31（台灣時間）

分支：`staging/personal-control-line-20261031`

開發基礎：`way0325-blip/Wayan`，main 基準 `2c4fae8dc22a89698617004853b5f743a05f0fda`。本報告描述首版增量交付，不代表八階段全部完成。未合併、未部署、未連接正式資料庫、未取用正式 Secrets、未建立付費資源。

## 已完成

- 唯讀盤點現有 Node/Express/PostgreSQL、API、資料結構來源、登入與權限。沒有聲稱已核對正式 DB 的實際 schema。
- 個人控制台：真實 API 統計、台灣日期、港口／蝦皮／可用率／異常通知、快捷操作與 SSE 同步。
- 安全 LINE Bot 程式：一次性綁定、本人任務、私人對話、到站／完成／異常／事故、驗簽、持久事件去重、交易稽核、處理失敗重試與回覆失敗追蹤。
- 人車派遣、改派、完成與狀態變更改用交易；新增休假／驗車阻擋與併發派遣檢查。蝦皮異動以交易內檢查和稽核防止併發超量與超額確認。
- 新增 checksum migration、獨立 staging 啟動範例與測試連線防護。

## 驗證結果

| 檢查 | 通過 | 失敗 |
|---|---:|---:|
| 語法檢查（原專案 lint 定義，擴大涵蓋所有 JS 與 inline script） | 49 | 0 |
| 單元及 PostgreSQL 整合測試 | 86 | 0 |
| 前後端 DOM 互動檢查 | 6 | 0 |

| 測試套件 | 通過 | 失敗 |
|---|---:|---:|
| api.test.js | 16 | 0 |
| control.test.js | 7 | 0 |
| dates.test.js | 7 | 0 |
| line.test.js | 16 | 0 |
| maintenance-attendance.test.js | 8 | 0 |
| order-tasks.test.js | 10 | 0 |
| safety.test.js | 2 | 0 |
| shopee.test.js | 18 | 0 |
| trust-proxy.test.js | 2 | 0 |

使用本機獨立 PostgreSQL 18 的 `wayan-staging-db`，非模擬資料庫；CI 設定為 PostgreSQL 16，執行結果另以 PR 狀態為準。本機 Node 24.21.0，目標 Node 22；尚未在 Docker 中執行（本機無 Docker）。沒有連接真實 LINE API；測試均使用假頻道及 LINE 回覆攔截。

六項 DOM 檢查：登入及 SSE 狀態、管理端綁定碼表單與資料庫串接、API 異動即時更新控制台、快捷入口導航、登出清除憑證、JavaScript DOM 錯誤為零。這些是 jsdom 互動檢查，**不等於實際瀏覽器排版、觸控或 CSP 驗收**。

npm audit --omit=dev：0 項已知漏洞；此次修補 lockfile 中 body-parser、ip-address、qs 的相容版本。這不代表已完成所有安全測試或滲透測試。git diff --check 通過。

測試修正歷程：先修正測試 schema 重設與初始化必須明確依序等待；接著修正既有測試刪除訂單後的人車 fixture；最後依新增需求把原先允許超額確認的測試改為驗證拒絕超額，修正檢查程式後全套通過。沒有刪除失敗案例來取得綠燈。

## API／資料表變更

新增 /api/control/summary、/events、/incidents、/incidents/:id/resolve，以及 /api/line/admin/status、/binding-codes、/bindings/:driverId、/events/:id/retry。既有 /api/line/webhook 換為綁定保護版本；缺簽章回 401，失敗處理回 503 允許重送。完整方法與權限見 STAGING-PLATFORM.md。

新增 schema_migrations、line_driver_bindings、line_binding_codes、line_events、operational_incidents、order_reports；僅新增結構與通知 triggers。既有資料及欄位保留。新增回報參照的訂單不得刪除，維持歷程完整。

## 未完成及風險

- 真實測試 LINE 頻道尚未接入；使用者已確認有獨立頻道，但金鑰未提供／未複製。需要獨立 staging 主機的 HTTPS 網址，才能完成 webhook 手機驗收。沒有上線網址。
- 內建瀏覽器無法連到受限制執行環境的本機預覽；備用 Edge 啟動失敗。因此未完成手機與桌面視覺驗收，沒有提供冒充完成的瀏覽器截圖。
- 船期／航次實體、四種進出口作業、完整請假核准／載重／維修流程、四角色網站權限、XLSX 匯入、車隊自助回覆、違規規則／覆核／申訴、主動 LINE 通知 outbox 與自動重試 worker 尚未完成。沒有自動計罰、扣薪或扣款。
- 既有非派遣 CRUD 的 best-effort audit、localStorage JWT、inline CSP、未分頁資料量、備份還原演練仍需後續處理；不將其描述為已驗收可營運。
- LINE 舊的群組直接完成、日編號與模糊櫃號指令刻意改成私訊本人任務，必須讓司機重新學習訂單編號指令。既有管理員群組推送仍保留，群組對象由管理員管理。
- LINE 外部回覆不能與 DB 一起提交；只保證資料異動的交易與去重，回覆失敗會記錄，不重播已完成的異動。
- staging DB 名稱檢查不等於主機隔離；接通遠端前必須核對測試主機、測試帳號與網路。自動測試會清空明確授權的本機 disposable staging DB，不能用於已有業務資料的環境。
- 測試版本使用全域交易鎖避免人車／車隊競態，高併發效能須另行驗證。事件資料保存期限與備份／還原政策尚待確立。

## 新增／修改檔案（40）

- `.env.staging.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `docker-compose.staging.yml`
- `docs/DELIVERY.md`
- `docs/STAGING-PLATFORM.md`
- `package-lock.json`
- `package.json`
- `public/control.css`
- `public/control.js`
- `public/index.html`
- `scripts/lint.cjs`
- `scripts/test.cjs`
- `server/db.js`
- `server/index.js`
- `server/line.js`
- `server/lineWorkflow.js`
- `server/migrations.js`
- `server/migrations/001_personal_control.sql`
- `server/orderService.js`
- `server/realtime.js`
- `server/routes/control.js`
- `server/routes/lineAdmin.js`
- `server/routes/lineWebhook.js`
- `server/routes/orders.js`
- `server/routes/secureLineWebhook.js`
- `server/routes/shopee.js`
- `server/stagingSafety.js`
- `server/tests/api.test.js`
- `server/tests/control.test.js`
- `server/tests/line.test.js`
- `server/tests/maintenance-attendance.test.js`
- `server/tests/order-tasks.test.js`
- `server/tests/safety.test.js`
- `server/tests/shopee.test.js`
- `server/tests/stagingSetup.js`
- `server/tests/trust-proxy.test.js`
- `server/transaction.js`
- `server/transactionalRouter.js`

## 審查與啟動

只交付開發分支與草稿 PR；不合併，不部署正式環境。請依 STAGING-PLATFORM.md 使用獨立測試設定與資料庫，待真實測試頻道、瀏覽器與各業務階段驗收完成後再評估正式發布。
