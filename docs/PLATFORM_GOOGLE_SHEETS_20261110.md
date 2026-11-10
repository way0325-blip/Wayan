# 全營運資料 Google Sheets 同步（2026-11-10）

目標帳號 way0325@gmail.com，沿用「Wayan 車隊營運紀錄」。不變更共享權限或正式環境。

## 行為

- 既有司機名冊、車輛名冊、出勤與班表保留雙向提交、版本核對及衝突處理。
- 44 個營運資料集另建「平台_」鏡像分頁，並建立「平台同步索引」。涵蓋路線及站點、固定來源車行、派車、報到與退趟、名冊、倉庫、群組、異常、罰款與歷程、權限角色及稽核。
- 鏡像分頁由平台維護，Google 的既有人工編輯頁不受覆寫。密碼、金鑰、Token、Webhook原始事件與報到雜湊不輸出。
- 由管理員啟用後，已提交的資料異動約15～60秒排入同步。Free服務休眠、Google配額或失敗重試會延後，並非保證零延遲。
- 遇欄位被修改、超過每資料集20,000列／總1,500,000格、授權失敗時，顯示失敗，不靜默截斷。
- 重試可復原部分寫入；只有全部寫入並回讀核對成功，才更新最後成功摘要。內容不變時不重寫。模擬資料不列入營運鏡像。

## API 與資料庫

- GET /api/platform-sheets/status：管理員、調度可讀目前目標、同步工作及最後成功狀態。
- POST /api/platform-sheets/sync：僅管理員，啟用並排入既有工作佇列；保留稽核。
- Migration 021僅補上缺少的資料異動通知trigger，不刪除表、欄位或歷史資料。
- settings 新增 platform_sheet_sync_enabled、platform_sheet_sync_state、platform_sheet_sync_plan。
- fleet_delivery_jobs沿用sheet工作，key為platformSnapshot；不增加付費資源。

## 檔案

新增 server/platformSheetData.js、server/platformSheets.js、server/routes/platformSheets.js、server/migrations/021_platform_sheet_notifications.sql、public/platformSheets.js、server/tests/platform-sheets.test.js、scripts/verify-platform-sheets.mjs。
修改 server/index.js、server/fleetSheets.js、server/fleetJobs.js、public/index.html。

## 驗證

針對性後端7成功／0失敗：完整schema、權限、通知、RAW防公式執行、既有分頁保留、清理尾列、欄位衝突、失敗重試。
介面7成功／0失敗：展開式分組、狀態、手動觸發、授權錯誤、無自動寫入及無瀏覽器例外。
完整回歸與雲端實際寫入結果另見交付驗收記錄。

## 限制

Google Sheets跨分頁沒有資料庫式交易；失敗時可能部分更新，索引與最後成功時間只於全數驗證後更新。稽核與LINE訊息等持續增長資料目前採有限全量鏡像，達上限需分期封存。來源第三方Sheet未獲授權仍採檔案匯入，不宣稱已自動讀取。
