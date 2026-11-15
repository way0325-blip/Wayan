# 共同群組與車隊改派（測試分支）

## 行為
- 各車隊公告群保留；共同群組按完整任務碼找目前執行車隊，不從訊息群組猜車隊。
- 管理員可選橘箱（NB/NJ/NC/FM/FN/FC）或黑箱（WB/WD/WC），以及允許的正式車隊。未知前綴不猜測。
- 接取仍核對 LINE 綁定司機身分。報到、異常及退趟沿用原交易、去重、稽核和 Sheets 佇列。
- 共同群組只回覆任務命令；完整站點由本人私訊查詢。不擷取其他群組對話。
- 改派保留來源車行與任務碼；可改其他車隊或退回待補車，需原因及版本核對。
- 已接取需先退趟；已報到或出發需先完成既有主管處理。此版本不直接覆寫交接或自動撤銷有效報到。
- 儲存設定與改派不發送 LINE。需要人工預覽發布。

## API
- GET /api/line/admin/drivers：完整名冊與既有司機安全投影，保留原綁定，不自動建立 LINE 身分。
- GET/PUT /api/fleet-ops/shared-groups：管理員設定群組、車隊允許清單及 businessScope。
- GET /api/store-delivery/fleet-changes/:id：改派歷程。
- POST /api/store-delivery/change-fleet：管理員交易式改派，含 tripId/version/fleetId/reason。

## 增量資料表
- 028 line_shared_group_fleets：群組／車隊多對多與任務類型。
- 029 delivery_fleet_changes：原車隊、新車隊、來源車行、原因、操作人與時間。
- 既有平台 Sheets 同步增加共同作業群組與車趟改派歷程投影；公司來源表不寫入。

## 檔案
server/lineDriverDirectory.js、server/sharedLineGroups.js、server/tripFleetChanges.js、server/lineWorkflow.js、server/lineActivity.js、server/lineGroups.js、server/fleetOperations.js、server/deliveryDispatch.js、server/platformSheetData.js、server/routes/lineAdmin.js、server/routes/fleetOps.js、server/migrations/028_shared_line_groups.sql、server/migrations/029_trip_fleet_changes.sql、public/control.js、public/index.html、public/sharedLineGroups.js、public/deliveryDispatch.js、server/tests/line-driver-directory.test.js、server/tests/shared-line-groups.test.js、server/tests/trip-fleet-changes.test.js、server/tests/driver-route-claims.test.js。

## 驗證及限制
本機只執行語法檢查與純模型測試；完整 PostgreSQL 整合交由 Linux CI。尚需測試站部署後選擇兩個實際群組，及真人 LINE→平台→Sheets 驗收。不可據本機模型測試聲稱雲端已啟用。
先前 Excel、來源路線與人員資料核對仍為獨立待完成項目，本次不聲稱完成。
