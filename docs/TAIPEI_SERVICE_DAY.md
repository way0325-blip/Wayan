# 台灣作業日自動切換

蝦皮工作區、車隊聊天室與夥伴車隊日期預設跟隨今天（Asia/Taipei）。頁面每30秒檢查日期，重新切回視窗或恢復可見時也檢查。跨午夜後更新日期並透過既有查詢 API 重新載入資料。

手動選擇非今日日期時保留指定日期，不跨日跳回今天。「回到今天」或各頁「今天」按鈕恢復自動切換。路線需求選擇全部日期時暫停工作區日期跟隨。有開啟表單時暫緩切換，關閉後於下次檢查更新。

不建立每日任務、不變更任務狀態、不傳送LINE訊息、不修改歷史紀錄。11月1日的30車測試仍可由日期選擇查閱；11月2日沒有任務時顯示空白。

## 變更檔案
- public/serviceDay.js：台灣日期與可暫停的日期跟隨器。
- public/shopeeWorkspace.js：日期切換、歷史保留、今天按鈕。
- public/index.html：載入日期工具及更新靜態資源版本。
- server/tests/service-day.test.js：跨日、跨年、歷史、表單保護與恢復測試。
- scripts/verify-delivery-dispatch.mjs：瀏覽器日期同步與歷史選擇驗收。
- docs/TAIPEI_SERVICE_DAY.md：行為及交付說明。

## API與資料庫
新增 GET /api/store-delivery/orders/export/csv?from=YYYY-MM-DD&to=YYYY-MM-DD，沿用管理員／調度授權。起迄日必填，最多31天及10000筆，超量拒絕而不截斷。匯出保留稽核、UTF-8 BOM與CSV公式防護。匯入沿用既有交易API，不接受重複編號覆蓋。沒有資料表、環境變數及migration變更，沒有新增排程服務或付費資源。

後台分為蝦皮店到店批次匯入／匯出下載兩頁，取代舊港口批次操作入口。舊港口API及歷史資料保留。新增 public/adminDelivery.js、server/deliveryExport.js；修改 public/storeDelivery.js 以支援從後台直接匯入及成功提示，server/routes/storeDelivery.js 註冊匯出端點，server/tests/store-delivery.test.js 增加下載驗收。

## 限制與風險
瀏覽器背景分頁可能被系統暫停，恢復視窗時補做日期檢查。時鐘依使用者裝置時間並套用台灣時區，裝置時間須正確。跨日僅更新篩選日期，排班仍需人工建立。不新增自動完成、逾時判定及自動罰款。

## 測試
lint 94項語法檢查通過；單元／整合205項成功、0失敗（含5項日期與3項匯出測試）；DOM介面47項成功、0失敗；157項既有規則仍保留待覆核。正式環境不變，PR保留草稿審查。
