# 移除大園倉與觀音倉選項

025增量migration增加倉別/取貨點active與倉別selection_label。停用大園倉實際取貨點及觀音倉區域；保留資料列與既有訂單外鍵、倉名、地址及歷史車趟。

大園區仍為長榮/水源實際取貨點的區域分組，選單改顯示「大園區（長榮／水源）」；不是大園倉取貨點。國際倉、仁美倉、威獅倉保持可選。

GET /api/store-delivery/config只回傳可選倉別與取貨點。訂單匯入、從既有訂單建新趟、路線建趟、每日需求預覽及測試任務選點皆檢查啟用狀態。歷史查詢與匯出仍可看到原名，私人Google鏡像新增可選取/選單名稱欄位。

無新增刪除API，無刪表刪欄，無自動改派既有車趟，不發LINE。測試改以長榮倉作為有效選項，新增3項整合案例核對停用防護及歷史保留；完整lint/CI由本分支執行。

變更檔案：server/migrations/025_retire_pickup_options.sql、server/routes/storeDelivery.js、server/sourceTripBuilder.js、server/stagingRouteAcceptance.js、server/dailyTasks.js、server/platformSheetData.js、server/tests/sourceCatalog.test.js、server/tests/store-delivery.test.js、本文件。
