# 路線雲端後台與時段群組（2026-11-11）

## 目的與操作

既有「平台_路線清單」移至前方並以藍色標記，顯示最新有效路線資料。新增黃色「路線後台設定」作為可編輯後台：K～N為變更來源車行、出車時段、車型、碼頭，O為遞增提交序號。空白沿用，填「（清空）」清除，填「（還原來源）」取消該欄覆寫並恢復來源設定。A識別碼隱藏，D～J目前值可由欄群組展開。路線編號與停靠站不可用自由文字任意改名，以維持既有訂單、報到及歷史關聯。

新增「路線時段群組」，按店配／隔日到貨／黑箱隔日到貨／一般上收／周六／周日上收，再按出車時段分層，可點＋／－展開收合。Google原生群組用於列與欄；既有分頁保留，不宣稱將分頁放進原生資料夾。

平台「蝦皮店到店 → 路線清單 → ★路線後台設定」可搜尋、調整相同欄位、還原來源設定、查看同步狀態及核對雲端衝突。

## 同步與保護

- 已啟用全項目Google同步的測試站，每60秒排入路線後台工作；部署重啟、舊工作租期、Google配額可能延後。
- 平台與Sheets修改同一有效版本才套用；版本衝突留待管理員明確採用Google或保留平台。相同提交序號不重複套用，識別碼重複拒絕套用。
- K～O草稿欄不被同步覆寫；已填但尚未提交的草稿保留原資料版本。寫入前重讀列資料，偵測排序或輸入改動後停止重試。
- 修改採獨立route_overrides，不改動匯入來源與歷史。僅影響路線範本及未來預設；不改派既有車趟，不發LINE、不計罰。
- 所有變更有稽核，資料庫套用採交易及鎖定。未填來源車行不推測補值；不同分類同編號車行衝突時，既有派車顯示待核對。
- 後台容納2000條資料（含已失效的歷史列），超限明確失敗，不清除歷史。現有96個分頁保留，另新增2個工作表。

## API

GET /api/route-settings：管理員／調度查看資料與Google工作狀態。
PUT /api/route-settings/:uid：管理員修改；verified、expectedVersion；reset可還原來源預設。
POST /api/route-settings/sync：管理員排入同步。
GET /api/route-settings/requests、POST /api/route-settings/requests/:key/resolve：管理員核對衝突。

## 資料庫與檔案

Migration022新增route_overrides與route_sheet_requests，保留既有表欄資料。
新增 server/routeOverrides.js、server/routeSheets.js、server/routes/routeSettings.js、server/migrations/022_route_sheet_backoffice.sql、public/routeBackoffice.js、server/tests/route-backoffice.test.js、scripts/verify-route-backoffice.mjs。
修改 server/routeCarriers.js、server/pickupRoutes.js、server/fleetSheets.js、server/fleetJobs.js、server/index.js、server/platformSheetData.js、server/platformSheets.js、public/sourceCatalog.js、public/pickupRoutes.js、public/index.html。

## 風險與驗收

Google Sheets並非交易式表單；寫入前偵測並行變動及版本核對降低覆蓋風險，仍建議用黃色變更欄提交，不在同步瞬間排序或改識別欄。雲端休眠與工作佇列會延遲，不能承諾零延遲。完整測試與實際雲端驗收另附交付記錄。僅staging，不新增付費資源、不更動正式環境或共享權限、不合併PR。
