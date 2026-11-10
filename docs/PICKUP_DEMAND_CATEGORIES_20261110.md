# 路線需求：上收分類

需求分類為上收、上收（周六）、上收（周日），單筆路線擇一。新增與編輯可選、清單可篩選，統計隨篩選改變。分類不會自動變更服務日期。既有資料保留未分類，不回填、不刪除。

## 檔案
- public/index.html：分類欄位、清單篩選、CSV 範本與匯入。
- server/routes/shopee.js：CRUD 與批次匯入驗證、回傳及稽核；已有分派不可變更需求分類。
- server/migrations/019_pickup_demand_categories.sql：新增 shopee_routes.demand_category，允許空白及三種分類，含 CHECK。
- server/tests/shopee.test.js：分類建立、保存、舊資料相容、非法分類及整批原子驗證。

## API
POST /api/shopee/routes、PATCH /api/shopee/routes/:id、POST /api/shopee/routes/import 的每列支援 demandCategory；GET 回傳 demandCategory。CSV 新增選填「需求分類」，舊範本仍相容。半形周六／周日括號正規化為全形。

## 驗證
lint 143 通過；本機獨立可丟棄 staging DB 整合測試 19 成功、0 失敗。未傳送 LINE，未修改來源 Sheets 或正式環境。

## 限制與風險
本次為需求分類，不是自動匯入來源表的資料列，也不是自動週末排程。來源表連接器無讀取權限；以使用者確認名稱為準。部署 migration 後才可使用新 API；需另行完成雲端版本及瀏覽器驗收，不能宣稱雲端已更新。
