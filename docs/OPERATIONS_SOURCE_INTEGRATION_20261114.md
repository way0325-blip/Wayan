# 包時、公司路線來源、每日回填需求與現行車隊整合

僅staging分支與獨立測試資料庫；不合併PR，不改正式站，不建立付費資源。

## 包時任務
五家車隊：元佑倉、風林火山、裕富、全華、富誠。唯讀讀取班表填寫(新)/班表回填(新)，日期、區域、車型、姓名、車號、班別、班次分欄。全華/裕富/富誠已確認原始分頁；另兩家目前沒有對應分頁，顯示來源待確認，不建立虛擬班次。姓名/車號回填不視為已驗證司機ID或LINE報到。班次名稱不推算費用，不自動計費。

026 migration新增hourly_task_snapshots與hourly_task_history，更新保留前後內容及稽核。API GET/POST /api/weekly-staffing/hourly，admin/dispatcher；讀取失敗保留上次資料。啟動90秒後及服務運行期間每5分鐘更新下一週期。

## 路線來源
主來源為12nj_N2zUrNHnYi0krf1kgorfqtJpz6y6MrMvAJ0WXSc固定NB/FN/WB分頁，沿用既有欄位檢查、站序、箱型及地區規則。補充元佑倉/富詠當期Raw原始分頁，僅C,D,F,G,H,I,J欄（不讀司機ID欄）。原始欄位位移經核對；補齊主來源缺少的編號，原主來源同編號優先，補充來源重複留待核對。保留每筆補充來源ID、分頁、列號與車行。1899/12/30不是出車時間，標記待核對。SER等未支援業務前綴不杜撰種類。

GET/POST /api/operation-sources/routes僅admin，更新前網路讀取完成再開交易；新增來源版本，保留已建立車趟快照。內容相同不重複寫版，可回復歷史內容為新版本。人工路線設定的來源列若移動則停止覆蓋。既有車行對照優先；未有對照的補充路線採用已核對的來源車行。啟動時更新一次，另有手動更新按鍵。

## 每日任務與跨日區間
使用者已確認每天固定台灣12:00～隔日08:00（含端點），在中午切換派車起始日，人工指定歷史日期不被自動改掉。每日需求以各車隊司機回填表路線為準，空白ID保留待填。依路線主檔起始出車時間判斷；無時間/缺主檔的需求獨立標示待核對，不當作確定區間內，也不可直接建趟。來源沒有某日就提示缺日，不推測需求。

027 migration新增company_staff_source_snapshots/history，保存原始矩陣與版本。GET /api/weekly-staffing/daily?date=起始日、POST /daily-refresh；admin/dispatcher。畫面支援全選/車隊全選、搜尋、複製需求；admin可選取取貨點後帶入既有每日建趟預覽，再人工確認建立。未自動建立、派車或發LINE。C/B長榮、T水源、D國際只用於已核對碼頭的預設；無對應碼頭必須人工選點。

實際車趟看板/選取/發布預覽共用window=noon查詢，跨兩個實際日曆日期，司機報到仍使用原實際作業日期。原API不帶window時維持單日。合計路線需求屬日需求，跨日視窗會讀取兩個日期需求，已建車趟統計僅該視窗，不能把部分視窗趟數當整日承接。

## 車隊
POST /api/operation-sources/fleets（admin）依10份回填表及既有有效車行對照補建同名車隊；不改已存在的停用狀態，不杜撰電話，不猜LINE群組，不自動發訊息。新增容量沿用系統0=不限額預設，需調度確認實際上限。模擬旗標/模擬備註車隊停用並從操作清單隱藏，保留所有引用與任務歷史。

## Google Sheets與測試
沿用私人營運簿，新增包時任務/包時來源狀態/每日回填需求/每日回填來源狀態四個鏡像；共51個業務資料集。公司來源內容唯讀。原有排班鏡像繼續更新。受來源管理且未被人工修改的預排會同步新版路線時間/店數；人工安排、實際車趟不覆蓋。

本機10個純模型測試通過；新增8個整合測試交Linux CI；完整lint/CI結果另附驗收報告。Render Free休眠時不保證5分鐘更新，使用手動按鍵可在喚醒後更新。實體手機視覺驗收尚未完成。

## 變更檔案
- server/migrations/026_hourly_tasks.sql
- server/migrations/027_company_staff_cache.sql
- server/hourlyTaskModel.js
- server/hourlyTasks.js
- server/dailyFleetTasks.js
- server/routeSourceRefresh.js
- server/vendorRouteSources.js
- server/realFleetRegistry.js
- server/routes/operationSources.js
- server/routes/weeklyStaffing.js
- server/routes/storeDelivery.js
- server/routes/fleetOps.js
- server/routes/shopee.js
- server/routeCarriers.js
- server/staffingSync.js
- server/index.js
- server/deliveryDispatch.js
- server/platformSheetData.js
- public/hourlyTasks.js
- public/dailyFleetTasks.js
- public/dispatchWindow.js
- public/operationSources.js
- public/dailyTasks.js
- public/deliveryDispatch.js
- public/storeDelivery.js
- public/serviceDay.js
- public/shopeeWorkspace.js
- public/shopeeIntegrated.js
- public/index.html
- server/tests/operation-source-model.test.js
- server/tests/weekly-staffing.test.js
- server/tests/platform-sheets.test.js
- docs/OPERATIONS_SOURCE_INTEGRATION_20261114.md
