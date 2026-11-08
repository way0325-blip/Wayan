# 園區停車場清冊新增與修改

僅測試分支。移除停車清冊私人JSON快照入口，改為新增停車紀錄及逐筆變更。

欄位：供應商、車牌、車型、用途（營業貨車／自用車下拉選單）、車主司機編號。車牌、車型及用途必填；車牌正規化後依用途檢查重複。既有來源同列兩種車輛以sourceRow加recordKey精確定位。

沿用POST /api/source-catalog/parking/entries及PUT /api/source-catalog/parking/entries/:sourceRow；管理員才可寫入，必須人工核對並提供expectedBatchId。多人同改回409，請重新載入。新增及修改採交易、稽核、不可變來源批次，舊資料保留。從Google預覽匯入時保留平台維護值。

無新增資料表或migration，沿用source_catalog_batches與audit_logs。未新增派車車輛、未變更正式環境、未發送LINE。

同步範圍：停車清冊本次為平台新增／變更及事件更新；未新增Google雙向維護分頁，原始Google交換表仍唯讀。司機／車輛原有Google同步功能不變。

UI採HTTP／JSDOM驗證，真實瀏覽器視覺驗收未完成。測試結果以交付報告為準。
