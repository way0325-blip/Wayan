# 固定路線接取、報到、退趟與改報（測試環境）

## 操作流程

1. 管理員到司機來源名冊，核對姓名、司機ID、來源列及有效證照，按「產生司機LINE綁定碼」。將一次性指令私訊給司機本人；10分鐘到期，僅儲存雜湊，重新產碼使舊碼失效。
2. 司機私訊 Bot 執行綁定。名冊中的任何有效且已綁定司機均可接取可用固定路線；不設每路線司機白名單。單獨輸入他人司機ID不能冒用身分。
3. 管理員匯入每日路線、核對取貨點／出車時間／件數，選取任務並指定車隊，再選擇發送Bot通知或複製LINE文字。
4. 群組輸入「接取 路線編號 司機ID」，如同一日同路線有多趟則使用完整任務編號。每個正式固定路線車趟一車、一位有效接取者；同時競爭由交易鎖及唯一索引防護。同一司機的未結束接取須先完成或撤回。
5. 接取成功回覆出車時段與總點數；完整地址與站序只由本人私訊「我的路線 任務編號」取得。群組通知、群組車趟清單及未接取查詢不公開完整路線。
6. 輸入「車趟報到 路線編號」。同帳號同有效車趟僅記一次；重送不增加報到數。接取與報到時間同步Google Sheets。
7. 誤報：輸入「退趟 路線編號 原因」；改報：輸入「改報 原路線 正確路線 司機ID 原因」。未出發時可自助撤回；已出發保留原報到，待管理員覆核。完成／取消車趟不自動重開。
8. 改報須同車隊、今日、不同且尚可接取的正式固定路線；目標無法接取時原車趟、報到及同步工作全部回滾。自有司機限本人已被指派車趟，可私訊操作；出發前退趟會釋放原自有司機與車輛。
9. 後台「固定路線接取、報到與退趟」可按日期查詢接取者、時間、有效數、Sheets狀態、原始報到歷程及待覆核退趟。管理員須輸入原因並勾選現場核對，才可代退／改報或核准。

## 資料與API

- 增量migration 013：drivers加入來源身分欄位；delivery_trips加入driver_claim_required；建立delivery_route_claims；報到加入driver_id／claim_id。來源司機橋接資料不列入自有派車選項。
- 增量migration 014：報到加入撤回時間／操作者／原因，建立delivery_active_checkins有效報到視圖及delivery_trip_returns。原報到資料不刪除，以部分唯一索引容許撤回後重新報到。
- 有效數、需求缺口、車隊報到、儀表板及派車防護統一讀取有效報到視圖。歷史查詢仍讀完整原始資料。
- 已存在模擬、已結束、已報到、需求非一車或非單一路線車趟保留舊版流程；新來源固定路線預設啟用接取。一般手動混合訂單舊流程保留。
- GET /api/driver-routes/board?date=YYYY-MM-DD&fleetId=：管理員／調度；最多1000車趟及最近200退趟。
- GET /api/driver-routes/trips/:id/checkins：管理員／調度；最近200原始報到歷程，無LINE原始ID或雜湊。
- POST /api/driver-routes/trips/:id/return：僅管理員；kind、reason、verified，選擇性checkinId／targetTripId。
- POST /api/driver-routes/returns/:id/review：僅管理員；decision、reason，核准須verified。
- POST /api/line/admin/roster-binding-codes：僅管理員；driverCode、sourceRow、verified；回傳一次性代碼，no-store。
- 既有認證、Webhook簽章、事件去重、權限、交易及稽核保留。群組一般聊天只列入動態，不自動回覆或建立營運資料；既有明確關鍵字仍可回覆。

## Google Sheets 與更新機制

營運試算表新增「車趟接取與報到」A:N及「車趟退回與改報」A:L，未改來源交換表。時間為台灣時間數值格式；固定紀錄編號對應固定列，以RAW寫入，防公式注入。退趟更新原接取列狀態並另保留退趟歷程。同步失敗保留工作與錯誤狀態，不冒稱已完成。

PostgreSQL提交後通知SSE，前端合併更新；Sheet工作由事件喚醒及15秒備援輪詢處理。外部API、網路及Free服務休眠會影響延遲，不能保證零延遲。Sheets設定每分鐘重算提醒公式。

## 十次LINE實測

測試碼N-TEST-9AC072E1：使用者確認10則分開發送，首次成功、其餘9次未重複計數。官方用量發送前2則，2026-11-07 23:24台灣時間讀取仍2則，觀察增加0。伺服器逐筆事件未完成核對：診斷查詢無匹配資料，另一查詢503；不宣稱逐筆伺服器稽核完成。不推播新訊息，測試啟動旗標已清空。

## 驗證與交付狀態

核心專項14成功／0失敗，包含競爭接取、冒用拒絕、本人私訊、撤回留存、回滾、覆核及自有資源釋放。完整回歸與UI結果另見交付驗證報告；本文件不得視為正式驗收完成。

尚待實際司機完成一次性綁定及新接取／退趟手機端驗收。未冒用來源名冊身分自動綁定。新Sheet欄位與原生格式已讀回，受瀏覽器控制限制未完成Google畫面目視驗收。Free服務休眠、免費DB到期與Push人數額度須在正式啟用前處理；未建立付費資源。

## 修改檔案

- public/control.js
- public/driverRouteDesk.js
- public/index.html
- public/sourceCatalog.js
- scripts/verify-source-catalog.mjs
- server/deliveryAliases.js
- server/deliveryCheckins.js
- server/deliveryDispatch.js
- server/deliveryLine.js
- server/driverRouteClaims.js
- server/fleetJobs.js
- server/fleetOperations.js
- server/fleetSheetSchema.js
- server/fleetSheets.js
- server/index.js
- server/lineKeywords.js
- server/lineWorkflow.js
- server/migrations/013_driver_route_claims.sql
- server/migrations/014_trip_returns.sql
- server/operationsSummary.js
- server/realtime.js
- server/routes/control.js
- server/routes/driverRoutes.js
- server/routes/drivers.js
- server/routes/lineAdmin.js
- server/routes/shopeeLive.js
- server/routes/sourceCatalog.js
- server/routes/storeDelivery.js
- server/stagingCheckinSetup.js
- server/stagingQuotaDiagnostics.js
- server/tests/driver-route-claims.test.js
- server/tests/line-incident-intake.test.js
- server/tests/line-keywords.test.js
- server/tripReturns.js

所有程式變更限測試分支，PR保留審查，不合併main，不更動正式資料庫或部署正式環境。
