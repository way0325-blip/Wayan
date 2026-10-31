# Wayan 完整物流營運平台：第一階段架構盤點

盤點日期：2026-10-31  
盤點基礎：`way0325-blip/Wayan` 的 `main` 分支唯讀檢查  
工作分支：`codex/wayan-platform-phase1-audit`

## 安全界線

- 本次只讀取 GitHub 原始碼，並建立獨立開發分支與本盤點文件。
- 未連線任何 PostgreSQL 資料庫，未讀取、複製或修改任何 Secrets。
- 未執行部署、未修改 `main`、未建立或合併 PR。
- 後續所有資料庫驗證只能使用經確認的獨立 `wayan-staging-db`；在確認其連線設定與隔離性前，不執行任何資料庫命令。

## 已確認架構

- Node.js CommonJS，Express 4，Node.js >=22。
- PostgreSQL，使用 `pg` Pool。
- 前端為 `public/index.html` 單頁 HTML/CSS/原生 JavaScript。
- JWT Bearer Token；目前角色為 `admin`、`dispatcher`。
- CI workflow 使用 PostgreSQL 16 service，執行 `npm ci`、`npm run lint`、`npm test`。
- 現有功能涵蓋港口訂單與派車、司機、車輛、車輛維修項目、調度差勤、出勤、蝦皮路線需求/車隊/分派、LINE Bot、操作紀錄及提醒。

## 已確認資料表（由 server/db.js 的初始化 SQL）

`users`、`drivers`、`vehicles`、`orders`、`vehicle_maintenance_items`、`dispatch_staff`、`shopee_routes`、`partner_fleets`、`fleet_routes`、`shopee_assignments`、`attendance_records`、`line_daily_index`、`settings`、`audit_logs`。

目前沒有在已檢查的 schema 初始化程式中看到違規案件、申訴裁決、LINE 司機綁定、LINE webhook 去重/重試等專用資料表。

## 重要缺口與風險

### P0：資料庫啟動與遷移方式
- `server/db.js` 在應用程式啟動時執行 `CREATE TABLE IF NOT EXISTS` 與 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，尚未看到版本化 migration runner 或 migration ledger。
- `seedIfEmpty()` 會在資料表為空時建立預設 admin，並寫入示範司機、車輛及訂單資料。這是既有行為；在確認資料庫環境前，不可啟動可能連到未知資料庫的服務。
- 建議後續以版本化、可追蹤、增量式 migration 取代散落在啟動流程的 schema 變更；不得刪除既有資料或欄位。

### P0：LINE 身分授權與事件可靠性
- 已檢查的 `server/routes/lineWebhook.js` 具 LINE 簽章驗證，但目前事件處理未見 LINE user ID 與內部司機帳號綁定檢查。
- 目前文字指令可查詢待派車/已完成/統計，且可透過編號或櫃號回報完成；這與「未綁定帳號不得讀取派車資料」的目標不符。
- 已檢查的 webhook 片段未見以 webhook event ID 建立唯一鍵去重，也未見持久化失敗佇列與重試狀態。
- 必須先設計綁定驗證、最小權限回覆、事件去重與可稽核重試，再擴充司機回報功能。

### P1：角色與授權模型
- 目前文件及登入授權主要只有 `admin`、`dispatcher`。
- 目標需要司機與合作車隊角色，以及細分至功能/資源/資料範圍的後端授權；不能只靠前端隱藏按鈕。
- 現有司機與車輛路由有登入驗證；部分新增/修改操作對所有已登入角色開放，需依新權限矩陣逐項檢視。

### P1：蝦皮多車隊派遣併發安全
- 已有需求、車隊、路線能力、分派及回覆資料表與 API。
- 後續需確認跨路線單日承接上限、同需求重複分派、並行請求與確認數更新是否全部由資料庫交易/鎖定/唯一限制保護；不能只依賴前端或先查後寫的應用程式檢查。

### P1：港口、人員、車輛營運模型
- 現有訂單含船名、櫃號、起訖點、時間、尺寸、狀態、司機及車輛欄位。
- 尚需盤點船期/航次主檔、進出口作業分類、車輛載重與車型容量、維修停用區間、司機出勤可用性與派遣衝突規則是否完整。
- 現有日期與時間欄位部分以 TEXT 儲存；需在不破壞舊資料的前提下評估一致化與驗證。

### P1：違規管理
- 已檢查的 schema 與 README API 清單未見完整違規案件、條款版本、主管覆核、申訴、裁決及人工罰款確認模組。
- 此模組必須將條款來源/版本及人工覆核列為必要條件；不得自動計罰、扣薪或扣款。

### P2：儀表板與系統管理
- 現有系統有基本儀表板、提醒與 audit log。
- 目標中的蝦皮缺車、車隊回覆率、司機/車輛可用率、違規待辦等整合指標，需由後端授權 API 提供一致口徑。
- 需補強稽核資料異動前後值、錯誤追蹤、健康檢查、備份還原演練與分頁/效能策略。

## 後續階段建議

1. 完成全目錄、所有 API route、前端呼叫、測試與既有 schema 的逐項盤點。
2. 建立角色/權限矩陣及版本化 migration 設計；先在測試資料庫驗證，不接觸正式資料庫。
3. 依序補強港口、人員、車輛核心模型。
4. 加固蝦皮多車隊分派的交易與併發保護。
5. 建立 LINE 司機綁定、簽章驗證、事件去重、失敗重試。
6. 建立違規條款版本與人工審核/申訴流程。
7. 整合儀表板與系統稽核。
8. 於獨立測試環境完成 lint、單元/整合/安全/手機與桌面驗收。

## 本階段驗收狀態

- 原始碼唯讀盤點：部分完成（核心檔案已檢查，尚未逐一檢查全目錄與全部路由）。
- 資料庫實際結構檢查：未執行（刻意避免未知資料庫連線）。
- lint / 單元 / 整合測試：未執行（尚未建立可確認隔離的 staging 測試環境）。
- 正式環境/正式資料庫/Secrets：未接觸。
- PR：尚未建立，保留後續人工審查。
