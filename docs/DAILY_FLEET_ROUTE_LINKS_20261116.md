# 每日任務日期、路線、車隊與群組連動

任務來源以公司回填快照的來源ID、來源列、日期所算出的key核對，不接受前端任意指定車隊。每日12:00至次日08:00保留每筆真實任務日期；以完整路線編號精確對應主檔與來源類型，跨性質同編號不混用。車行使用既有dispatch_source_fleet_aliases，LINE使用已驗證line_fleet_groups及Bot在場狀態；不依群組名稱猜測。

任務派車內選取需求→核對時間及取貨點→預覽每筆日期、路線、車隊、群組→確認建立，或確認建立並發布LINE。不再必須跳去匯入頁。發布使用既有去重佇列，排隊不宣稱送達。未綁定群組可建立指派任務，不能直接發布。原有人工改派、已接取或報到不被來源同步覆蓋，沿用既有容量限制。

路線清單更名路線資料庫，沿用增量版本source_catalog_batches與route_overrides，不另建平行資料庫。來源每小時更新，統一手動同步可由資料庫入口操作；既有Google雙向可調整欄位與歷史保留。

新增API POST /api/source-catalog/daily/dispatch（admin，verified、rows、digest）；既有preview/commit可接受staffingSourceKey與dispatchDay並回傳車隊／群組核對欄位。所有新增車趟、分派、通知佇列與稽核同一交易；不增加資料表或migration。

修改server/dailyFleetLinks.js、dailyFleetTasks.js、dailyTasks.js、sourceTripBuilder.js、deliveryLine.js、routes/sourceCatalog.js；public/dailyFleetTasks.js、dailyTasks.js、shopeeIntegrated.js、index.html。新增兩個daily-fleet測試檔。UI離線12項斷言通過；完整測試與lint由CI驗證。未自動發送真實LINE、未修改公司來源或正式服務。

限制：平台目前僅登記1筆單一車隊群組綁定，其他車隊需要Bot入群及實際群組核對；不虛構綁定。上收等其他來源性質不能套用店配建趟API，保留待核對與原操作流程。