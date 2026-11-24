# 地區規則與三類上收路線

## 規則
依原路線編號以半形 - 分割，取第二段，01雙北、02/03桃園、04新竹、05苗栗、06宜蘭、07瑞芳、深坑、08台中；不受前綴影響。空白為未填；格式錯誤及未知代碼為待確認。地區欄獨立於門店地址行政區，未修改原路線編號。上收匯入保留每筆與重複資料，不假設星期自動排班。

## 介面
既有蝦皮路線及週期路線清單新增地區。路線範本與每日任務匯入區增加「上收路線」展開模組，分為：北倉上收路線、北倉上收路線-禮拜六、北倉上收路線-禮拜日。每類各自匯入CSV/TSV、預覽、核對儲存，支援路線／車行搜尋及地區篩選。必要表頭為路線編號，車行、出車時段、碼頭、任務類型為選填。

## API／資料表
新增 /api/pickup-routes：GET ?category=分類、POST /preview、POST /import。登入與後端角色驗證：管理員／調度可讀，管理員可寫。匯入需 verified、digest、expectedBatchId，資料及稽核在同一交易，防止舊版本覆蓋、重送不重複新增。
Migration 020 新增 pickup_route_batches；無既有表欄刪除，來源版本保存，提交事件提供介面更新。既有 source-catalog 與 weekly catalog 回傳 region／regionCode。車行對照支援 SER 等前綴；這不代表未確認箱型的路線已可自動建配送車趟。

## 檔案
- public/routeRegions.js：共用地區判定。
- public/pickupRoutes.js：三分類清單與匯入介面。
- public/sourceCatalog.js、public/weeklyRoutes.js：地區欄。
- public/weeklyRouteFormat.js：上收欄位白名單及保留原始路線文字。
- public/index.html、public/progressiveLayout.js：載入與展開模組。
- server/pickupRoutes.js、server/routes/pickupRoutes.js：分類資料、版本及權限API。
- server/routeCarriers.js、server/routes/sourceCatalog.js、server/weeklyRoutes.js：地區投影與任意前綴對照。
- server/index.js：掛載獨立JSON大小上限及路由。
- server/migrations/020_pickup_route_catalog.sql：新增版本表與通知。
- server/tests/sourceCatalog.test.js、server/tests/weekly-routes.test.js：判斷、原文、重複、空白、版本隔離、衝突與前綴測試。

## 驗收與限制
附件376筆已在本機計算地區，未將商業原始資料提交Git。提供地區核對JSON及車行對照匯入準備檔在workspace outputs。
右側來源表瀏覽器工具回報 browser.user is unavailable，三個新分頁尚未實際讀取或匯入；需要各分頁CSV/TSV才能核對真實欄位及資料。不得宣稱已自動同步來源Google表。新分類只建立路線來源清單，沒有足夠核實的完整站點、箱型時不自動建立車趟或推送LINE。正式環境與來源表未變更，未建立付費資源，PR保留草稿。
