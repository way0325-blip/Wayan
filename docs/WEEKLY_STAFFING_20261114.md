# 週期人員排班與待補清單（2026-11-14）

蝦皮店到店新增「週期排班」分頁，保留原派車與固定路線流程。頁面以本週應出車、已安排、還要補齊、需立即處理四個入口呈現，按車行收合明細。車行、日期、業務、司機ID可搜尋／篩選，歷史週期不覆蓋。

## 已確認規則

- 週二至下週一：2026-11-17～11-23；整週司機ID請於2026-11-16（一）23:59前填齊。
- 每項任務最晚於執行日前一天23:59前填入有效ID；兩個期限分開計算，不以單日期限延後整週截止。
- 全部使用Asia/Taipei日界線；23:59:59.999仍屬期限內，隔日00:00才逾期。
- 業務前綴NB/NJ/NC為主線，FN/FM/FC為NDD，WB/WD/WC為WHNDD；上收分類保留，未確認前綴標待核對。
- 預排司機與LINE實際接取／報到分開，不自動新增司機、綁定LINE、建立車趟、發送訊息或計罰。

## 操作

1. 選週二開始的週期。選路線並明確勾選實際執行日期，每條線每個日期建立一趟；加開可另命名波次。重送相同需求不新增第二筆。
2. 下載本週填寫範本，填司機ID後匯入UTF-8 CSV／TSV，或貼上含表頭的Excel儲存格。ID使用文字格式保留開頭0。不是直接解析.xlsx，也不讀取LINE圖片。
3. 預覽核對後一次套用；空白略過、不清空舊安排；（清空）才清除司機。缺少日期且無需求編號時拒絕，不假設整週同一人。
4. 有效名冊ID且已指定車行才算已安排；查無、重複、停用或名冊資料待核對均不算完成。截止後補填保留填寫時間。停駛／恢復需原因並保留紀錄。
5. 點還要補齊，按車行看缺填；可匯出目前清單、預覽並複製催填文字，由操作人自行貼至對應LINE群組。程式不自動傳送。

## 資料與API

Migration023新增staffing_cycles、staffing_demands、staffing_history，不刪除既有資料。需求唯一鍵為週期、來源路線識別碼、日期、波次。修改使用revision檢查、交易、稽核；匯入預覽摘要涵蓋需求版本與名冊版本，任何來源錯誤整批拒絕。無效ID可保存為待核對，但不計已安排。

管理員與調度可用：
- GET /api/weekly-staffing?start=YYYY-MM-DD、GET /options、GET /history/:id
- POST /cycles、POST /demands、PUT /demands/:id
- POST /preview、POST /import

所有API皆有登入與後端角色驗證；司機／車隊角色不得讀取整週跨車隊人員資料。既有停用的/api/weekly-routes保持410，不復活舊週期碼頭套用功能。

既有私有Google營運試算表新增平台_排班週期、平台_排班異動歷程、平台_週期排班三個鏡像，由原工作佇列同步。鏡像不是回填入口，不能直接修改後期待回寫。預排與司機ID不放到已公開的外部小工具。

## 檔案

新增server/staffingModel.js、server/weeklyStaffing.js、server/routes/weeklyStaffing.js、server/migrations/023_weekly_staffing.sql、public/weeklyStaffing.js、public/weeklyStaffing.css、server/tests/staffing-model.test.js、server/tests/weekly-staffing.test.js、scripts/verify-weekly-staffing.mjs。
修改public/shopeeIntegrated.js、public/index.html、server/index.js、server/platformSheetData.js、server/tests/platform-sheets.test.js。

## 限制

尚未取得實際週表，僅支援明確範本欄位或需求編號／日期＋路線的回填，不宣稱可自動讀取外部LINE／Google來源或原始Excel工作簿。執行日期必須由操作人確認，沒有自動把所有路線乘7。此版不自動判斷跨區行程時間衝突，也不強制LINE實際司機必須等於預排司機。來源路線資料變更不覆寫已建立的週期需求快照；需人工調整／停駛後重建。

每週最多5000筆需求（含停駛歷史），Google鏡像全量最多20000列，超限明確失敗。服務休眠、Google工作佇列與資料來源尚未同步會影響即時性，畫面顯示資料讀取時間，不能把最後讀取時間誤認外部來源已完整同步。

只修改staging，不使用正式資料庫、不新增付費資源、PR保留審查不合併。測試與雲端部署結果另附交付紀錄。
