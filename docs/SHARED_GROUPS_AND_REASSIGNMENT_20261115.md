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

## 統一指令及追加需求
- 接單→接取、報到→車趟報到、查任務→車趟狀態、退單→退趟、回報→車趟異常；只轉換第一個指令詞，不改司機ID或說明內容。
- 來源群組須由管理員選擇啟用，只有啟用後的新文字訊息擷取為待確認草稿；無法回讀歷史。未設定時不自動擷取所有群組。
- 030 新增 line_demand_sources、extra_transport_demands、extra_transport_slots、extra_transport_history，全部保留稽核及 Sheets 投影與即時觸發器。
- 確認需求後建立獨立 E 車位，逐車指定車隊，路線可後補；不得偽造門店或直接建立固定路線車趟。
- E 任務可提前接單，作業當日報到及完成；相同司機重送不重複報到；已接取／報到不得直接覆寫車隊。已報到退單需人工主管處理，此版不提供一鍵覆寫。
- E 任務目前支援接單、報到、查任務、退單、完成、異常回報（沿用案件及 Sheets 佇列）；改報只適用固定路線任務，E 任務已報到後須由調度聯絡處理。
- 新 API：GET /api/fleet-ops/extra-demands、PUT /api/fleet-ops/demand-source、POST /api/fleet-ops/extra-demands/:id/confirm、PUT /api/fleet-ops/extra-slots/:id，全部管理員授權。
- 新檔：server/botCommands.js、server/extraDemandModel.js、server/extraDemands.js、server/migrations/030_extra_demands.sql、public/extraDemands.js、server/tests/bot-commands.test.js、server/tests/extra-demand-model.test.js、server/tests/extra-demands.test.js。
- 截圖不當成已核實路線：尚未接上 OCR。需人工核對路線編號後填入，不會猜測圖片內容。

## LINE罰款訊息與既有規則
- 範例 WB-04-202-1 20941 跳線罰款3000 只建立 V 待核對訊息，不直接建立確認罰款。
- 031 penalty_message_drafts 保存路線、司機ID、原訊息金額、原文、來源事件與人工案件連結，新增平台 Sheets 待核對分頁。
- 已核實規則以項目文字提供候選清單，不猜發生日，不自動選版本、不自動沿用3000元。
- GET /api/penalty-cases/message-drafts 及既有 POST /api/penalty-cases 的 messageDraftId 可原子連結人工立案，重送不重複。
- 原規則參考金額、原訊息金額、主管人工確認金額分開；未核實條款不可計罰，無自動扣薪扣款。
- 新檔 server/penaltyMessageIntake.js、server/migrations/031_penalty_message_drafts.sql、server/tests/penalty-message-model.test.js；修改 public/penalties.js、server/routes/penaltyCases.js。

## Excel與每小時同步
- 新增 ExcelJS 4.4.0，exceljs 的 uuid 覆寫鎖定11.1.1；npm audit 0 vulnerabilities。採登入後伺服器解析，不送往第三方服務。
- POST /api/excel/read、POST /api/excel/write；4MB壓縮檔、32MB解壓、1萬筆、64欄及30萬格限制。拒絕巨集、加密、外部活頁簿連結、超限檔案與公式（先貼上為值）。司機ID及路線文字保留前導零。
- 訂單Excel範本、匯入、按日期匯出xlsx；既有CSV保持相容。排班、每日任務、路線與車行對照加入xlsx入口。
- Google來源讀取：公司回填、包時、名冊、出勤、路線後台改為每60分鐘；服務啟動保留原有錯開讀取，免費服務休眠期間不保證準點。
- LINE事件、資料庫異動通知、Google寫入佇列仍即時／短間隔處理，不故意延遲1小時。
- 名冊與出勤手動「立即更新」先讀Sheets，再排入平台輸出；公司路線、公司回填、包時保留既有立即更新入口。
- 新增 POST /api/operation-sources/pull（管理員），僅允許drivers/vehicles/attendance，沿用版本衝突保護。

## 回填對帳及新路線來源
- 原始格數／已填ID／空白／本次已套用／待核對未套用／重複格數分開，不把「已填ID」當成「已核對可派車」。不自動合併有衝突的來源列，也不刪除資料。
- 每日任務顯示來源兩日格數、區間外排除格數及可見需求，滿足來源格數＝區間外＋可見（格式異常另列待核對）。已知路線但時間不明可勾選，建趟前必須逐筆補上有效時間。
- 路線網路讀取改為1fgzigNTy_Vx-SMuu-affuOZ-RNquBbs0AZeMRxOHZf0；保留舊SOURCE_ID作內部名冊、歷史與綁定命名空間，未改寫來源公司試算表。
- 三個主路線表動態依已驗證分頁界限讀取，上限4000列，避免WB新增列被舊3396列截斷。
- 支援車趟來源一併核對。2026-11-15實讀為6/28的18筆，0X占位碼、非數字站序且缺門店地址，列為待核對，不假造正式路線。
- 新檔server/routeSupportModel.js；另修改server/sourceCatalogBootstrap.js、server/sourceCatalog.js、server/dailyFleetTasks.js、server/staffingModel.js、server/staffingSync.js及對應前端與測試。
