# 固定路線車行更新與移除週期功能

## 最終範圍
依使用者最新指示移除週期核對、日期區間選版、週期匯入與週期建趟。原固定路線、一般及週末上收、每日任務匯入保留。歷史dispatch_source_batches的weekly資料與既有車趟保留，不刪表、不刪欄、不覆寫歷史派車。

固定車行對照改用 /api/route-carriers 的catalog/directory/preview/import/fleet-alias。僅接受mapping，不接受weekly。舊 /api/weekly-routes 已登入請求回410，不能再執行匯入或建趟。移除server/weeklyRoutes.js、public/weeklyRoutes.js、前端period/serviceDate區間推算及原週期介面，保留通用CSV/TSV/碼頭字典工具。

## 派車資訊
以車趟有效停靠資料的完整route_code，批次核對最新已匯入固定車行版本。GET dispatch-board與trips增加：source_fleet_name（目前核對）、source_fleet_snapshot（建趟原值）、source_carrier_status、source_carrier_mapping_id、source_route_carriers。
多車行、未填、未知、重複對照不繼承舊車行或自行推測。來源車行與實派車隊分開顯示於車隊任務清單、分派預覽、車趟明細與工作台；既有fleet_id、司機、車輛、報到及派車版本不變。新建固定路線車趟另保存建趟時來源車行快照；不自動指派LINE群組。

## 變更檔案
- server/carrierMappings.js、server/routes/carrierMappings.js：固定車行來源版本、稽核與明確別名。
- server/routeCarriers.js：路線／派車批次唯讀對照投影。
- server/deliveryDispatch.js、server/routes/storeDelivery.js、server/sourceTripBuilder.js：派車資訊及新建快照。
- server/shopeeDirectory.js、server/index.js、server/routes/weeklyRoutes.js：新API與舊介面停用。
- public/carrierMappings.js：固定車行對照匯入與別名設定。
- public/fleetTasks.js、public/deliveryDispatch.js、public/storeDelivery.js：來源／實派車隊呈現。
- public/shopeeIntegrated.js、public/progressiveLayout.js、public/weeklyRouteFormat.js、public/index.html：移除週期畫面與流程、快取更新。
- server/tests/route-carriers.test.js、server/tests/sourceCatalog.test.js、scripts/verify-carrier-dispatch-sync.mjs、scripts/verify-shopee-integrated.mjs：授權、來源版本、退休端點、資料保護及介面驗證。
- 刪除舊週期service、public介面、server/tests/weekly-routes.test.js、scripts/verify-weekly-routes.mjs；改測固定對照與停用保護。

## 驗證與限制
本機隔離DB後端64成功、0失敗；介面9成功、0失敗；lint152通過。正式環境與main未更動，無migration。376筆已核對車行資料準備檔仍需於測試站明確匯入核對後才會成為最新來源；22筆未填不推測。Google所有營運項目的完整同步為後續獨立交付，不宣稱此PR已全數串接。未發送LINE，未建立付費資源。
