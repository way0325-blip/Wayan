# 週期回填空白類型與待補路線

來源：既有十份公司司機回填表，保留原表唯讀。

## 行為
- 類型欄空白、空白字元或沒有值時，有有效路線編號與週期日期的需求仍匯入；原始類型保留在來源連結位置資料。司機空白仍是待填需求。
- 路線主檔不存在時，建立週期需求，明細待補；路線UID為來源需求識別值，不建立假的路線主檔。stop_count=NULL代表未知，時段空白，不填0店。
- 主檔後續補齊時更新原需求UID與明細，保留需求編號、司機及歷程。
- 重複或衝突來源、人工調整、已停駛與來源清空司機仍保留核對流程，不自動覆蓋。
- 匯入的是排班需求；不自動建立實際配送車趟、發LINE、報到或計罰。

## 檔案
server/migrations/035_staffing_pending_routes.sql
server/staffingSourceModel.js
server/staffingSync.js
server/staffingModel.js
public/weeklyStaffing.js
server/tests/staffing-source-model.test.js
server/tests/weekly-staffing.test.js
docs/STAFFING_BLANK_TYPES_20261115.md

## API／資料表
沿用 /api/weekly-staffing/source-sync、source-snapshot、board 與每小時同步。新增報告欄 blankTypeCells、pendingRouteCells；需求projection含metadata_problem。增量migration035允許staffing_demands.stop_count為NULL，無刪除資料表、欄位或歷史。

## 驗證與風險
本機模型13成功0失敗；完整資料庫整合測試見本次CI。測試涵蓋空白類型七天保留、未知明細不算排齊、重複同步不增筆、補主檔後原任務延續。大量待補需求仍須人工補主檔；來源存取失敗保留舊資料。公司Web OAuth用戶端尚未匯入，不能宣稱公司來源授權完成。僅測試分支，PR保留審查，不合併、不更動正式環境。

## 統一更新按鈕
public/unifiedSync.js提供全站「立即同步並更新畫面」，依序呼叫既有路線、人員來源、選取週期回填、選取包時週期、司機／車輛／出勤Sheet變更API。採既有後端登入與角色驗證；按鈕僅管理員可用。載入頁面不會自動執行整批外部讀取。
部分來源錯誤仍執行後續來源，保留逐項結果並明確顯示未完整更新；整批成功後再重新載入畫面，不改所選日期／週期。避免連點重複同步，登出清除結果並停止後續步驟。原分散來源更新按鈕收起，查詢／匯入／派車操作不變。
自動來源讀取沿用server/syncPolicy.js的60分鐘，服務運行期間執行；本機／雲端休眠期間不保證整點執行。LINE事件及資料異動的Sheets佇列不被延遲成每小時。無新增付費服務、API或資料表；瀏覽器重新整理本身不會觸發外部寫入。
本機統一同步UI12項成功0失敗。新增／修改public/unifiedSync.js、public/index.html、public/personnelSources.js、public/staffingSync.js及本文件。

統一按鈕另將路線後台、出勤與全營運Google輸出排入既有同步佇列；明確顯示排隊中，不將queued回覆當作已送達。共10個處理步驟，來源失敗不阻斷後續。UI13項成功0失敗；public/routeBackoffice.js的舊60秒提示同步改為每1小時。

## 每日回填需求類型欄
每日需求API在每筆rows新增sourceType（直接讀取回填來源B欄類型，空白保留空字串）；不以主檔category覆寫來源類型。前端在路線／店數旁新增類型欄，空白顯示未填，搜尋包含來源類型。原需求選取、跨日範圍、建趟檢查與來源筆數不變。
檔案：server/dailyFleetTasks.js、public/dailyFleetTasks.js、public/index.html、server/tests/operation-source-model.test.js及本文件。API沿用/api/weekly-staffing/daily，無資料庫migration。模型13成功0失敗、作業UI14成功0失敗；全套CI另核對。
