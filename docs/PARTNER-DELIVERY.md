# 夥伴車隊與 LINE 多群組：本次交付

日期：2026-10-31（台灣時間）。分支：`staging/partner-fleets-line-sheets-20261031`。開發基礎為前一版測試分支提交 `1b96b1786ad5b189ae4f333e741a17458436835b`，沒有修改 main、合併 PR 或部署正式環境。

## 已完成

- 車隊搜尋、分頁、聯絡資料、每日容量與停用保留歷程。
- 同一測試 Bot 支援多群組，每群組對應一個車隊；一次性綁定碼、解除綁定、跨車隊操作拒絕。
- 一般車隊任務、LINE 通知工作、承接／拒絕／到站／完成，以及與既有蝦皮分派共用每日容量。
- 異常回報單、案件編號、處理人、狀態覆核、人工結案及完整追加歷程，可列印。
- LINE 推送重試鍵、Google 固定資料列同步、RAW 防公式注入、失敗／待設定／重試狀態、背景補送。
- 新增增量 migration 002、API 與前端操作介面，保留既有架構和資料。

## API 與資料表

新增 /api/fleet-ops 下的 status、fleets、group-code、tasks、notify、cancel、incidents、jobs、sheet-target、sheet-resync。所有管理 API 需登入及角色授權，群組綁定與同步設定限 admin；結案與重開限 admin。完整方法表見 PARTNER-FLEETS.md。

新增 line_fleet_groups、fleet_group_codes、fleet_work_orders、fleet_incidents、fleet_incident_history、fleet_sheet_rows、fleet_delivery_jobs。沒有刪除或重新命名原有資料表／欄位。任務及案件異動與稽核／同步佇列同交易提交。

## 驗證

| 檢查 | 通過 | 失敗 |
|---|---:|---:|
| 語法檢查（專案 lint） | 56 | 0 |
| 單元及真實 PostgreSQL 整合測試 | 110 | 0 |
| 車隊 DOM 前後端互動檢查 | 6 | 0 |

新 fleet-ops.test.js 共 24 項，包含群組隔離、綁定碼失效、任務 idempotency、通知重試鍵、容量共用、案件覆核、失敗回滾、Google 不確定回應重試、資料列保護及自動擴充範圍。其他原有 86 項測試繼續通過。DOM 驗證：車隊營運頁載入、車隊名冊表單串接資料庫、多群組綁定碼顯示、車隊任務表單串接資料庫、異常回報單與處理歷程、回報內容以純文字顯示，阻擋 HTML 注入。DOM 驗證不等同手機／桌面實際瀏覽器或列印排版驗收。

測試使用獨立本機 PostgreSQL 18、55449 埠與 pg-fleet-tests 資料目錄，DB 名稱仍為 wayan-staging-db。沒有連到使用者目前平台的 55439 資料庫，也沒有連到正式 DB。測試中的 LINE／Google HTTP 全部攔截，未傳送真實訊息或營運資料。

本次另以已連接的 Google Drive 真正建立一份空白原生 Google Sheets，核對五個分頁、標題、台灣時區及總覽公式無錯誤；記錄工作表預留 5000 筆。測試案例沒有留在雲端表單中。雲端建立連結另交付，不將使用者專屬 ID 寫入公開原始碼。

## 未完成與風險

- 只完成本機群組設定介面與模擬外部 API 的串接驗證，沒有實際建立 LINE 官方帳號、建立群組、邀請 Bot 或對真實群組傳送訊息。
- 使用者提供的既有 Webhook 網址尚未核對為獨立 staging。本次沒有更動該網址、對它發送測試事件或把測試 Bot 指向它。依既有安全限制，不能直接使用未確認的既有服務。
- 真實 LINE 需要專用測試頻道、允許入群、群組成員邀請、各群組／車隊對應及可供 LINE 接收事件的 HTTPS staging Webhook。localhost 不可直接接收 LINE 外部事件。本次沒有建立外網通道或付費資源。
- Google Drive 連線已建立雲端表單，但不會提供 Node 後端無人值守寫入 token。尚需獨立 service account 與指定試算表的編輯授權；沒有建立新 Google Cloud 專案、service account 或複製正式 Secrets。未設定時平台工作顯示待設定，資料保留待補送。
- 群組內成員均可操作該車隊任務，必須由車隊管理群組名單；尚無逐位群組成員細分角色。
- Sheets 原始資料列請勿任意插刪、排序或改名；系統偵測編號／標題不符會停寫以保護既有資料。
- 背景同步每十五秒最多三筆，可能有佇列等待。LINE 受理不代表已讀；五次失敗及超出重試窗口需人工確認。
- 本次表單為 Google Sheets 結構化工作表與平台列印單，不是 Google Forms。照片、附件、已讀追蹤及正式帳務／扣款未實作。
- 目前本機正在運作的舊 Node 程序需要重新執行啟動器才會載入新 API 與 migration；啟動器已加入舊版偵測與保留資料的正常重啟流程。實際桌面重啟仍需使用者執行，不以內部測試當成瀏覽器已成功連線。

## 新增／修改檔案（22）

- `.env.staging.example`
- `.github/workflows/ci.yml`
- `README.md`
- `docker-compose.staging.yml`
- `docs/PARTNER-DELIVERY.md`
- `docs/PARTNER-FLEETS.md`
- `public/control.css`
- `public/fleets.js`
- `public/index.html`
- `server/fleetJobs.js`
- `server/fleetOperations.js`
- `server/fleetSheetSchema.js`
- `server/fleetSheets.js`
- `server/index.js`
- `server/line.js`
- `server/lineWorkflow.js`
- `server/migrations/002_partner_fleet_operations.sql`
- `server/routes/fleetOps.js`
- `server/routes/shopee.js`
- `server/tests/control.test.js`
- `server/tests/fleet-ops.test.js`
- `server/transactionalRouter.js`

本機啟動輔助檔另更新 work/open-preview.mjs、outputs/start-wayan.cjs 與 work/fleet-sheet-target.json（只有新雲端試算表 ID，沒有金鑰），不屬於公開 GitHub 專案內容。

## 本機驗收

重新執行既有 Open-Wayan-Fixed.cmd → 登入 → 夥伴車隊營運 → 新增車隊／建立任務／取得群組綁定碼／登記異常／開啟回報單／查看處理歷程。雲端連結可在設定完成後開啟，後端金鑰未設定時不會冒充同步成功。

先以獨立測試環境完成 PR 審查與上述驗收，不合併、不部署正式環境。
