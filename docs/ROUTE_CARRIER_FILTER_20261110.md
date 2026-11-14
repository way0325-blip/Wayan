# 蝦皮路線車行對照與篩選

使用已核對匯入的「路線&車行」最新版本，按完整路線編號與原有 NB／FN／WB 路線精確比對，查詢時帶入來源車行。不是新增重複路線或覆寫來源歷史。重複對照、空白車行及不相符編號不猜測。

## 檔案
- server/routeCarriers.js：唯讀路線與車行關聯投影。
- server/routes/sourceCatalog.js：GET /api/source-catalog/:kind 與 /:kind/options 支援 carrier 篩選及 sourceFleetName、carrierMatch、carrierMappingId 回傳。
- public/sourceCatalog.js：車行欄、車行下拉篩選、路線選單、全選及來源變更更新；建立車趟核對畫面顯示來源車行。
- public/index.html：腳本版本更新。
- server/tests/sourceCatalog.test.js：精確配對、篩選、重複對照及歷史資料保護整合測試。

## 操作
蝦皮店到店 → 原有蝦皮路線範本 → 選配送性質與出車時段 → 車行篩選 → 勾選／全選目前篩選結果 → 使用選取路線 → 人工派車。
carrier=__pending__ 表示未對應／待核對；未填 carrier 表示全部。篩選在分頁前進行，選取全部使用相同條件。

## 驗證與限制
本機隔離 staging DB 整合測試 38 成功、0 失敗，lint 144 通過。來源 Google Sheets 尚無服務帳戶讀取權限，依昨天已儲存的檔案對照版本顯示，未宣稱即時抓取來源表。來源車行為參考資料，實際 LINE 車隊指派仍須人工選擇；不因名稱相似自動合併。無資料表變更、無 migration、無實際 LINE 發送，未變更正式環境。
