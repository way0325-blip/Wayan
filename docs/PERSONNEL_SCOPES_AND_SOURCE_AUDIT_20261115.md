# 人員範圍、月份班表與來源路線核對

## 來源範圍
運務士Google班表只保留D欄出發倉庫為桃園的資料，依B欄日期查詢、H欄工號與K欄姓名核對。A欄紙本核對不當作是否出車。
調度只保留北倉（相容北／N-SOC識別），依所選日期讀取對應N月休假需求。月份表頭與來源年份必須相符，空白為未標記，不推定出勤或核准休假。

## 自有司機實際新增
只有自有名冊與Google運務士班表本次都讀取成功，才檢查所選日期的桃園執行人員。工號與姓名須唯一對應自有名冊、配合中、電話證照格式完整。新增至既有drivers，稽核與新增使用交易。重複ID／同名異ID保留核對；既有人工欄位不覆寫；不建立LINE綁定、不自動派車。證照已到期新增為停派。來源仍缺授權時不會虛構新增成功。

## 月份保存與API
沿用personnel_source_snapshots，dispatcher_leave:YYYY-MM保存各月快照；不刪歷史、不新增migration。
GET /api/operation-sources/personnel?date=YYYY-MM-DD依所選月份取資料；POST同路徑接受date，無date沿用台灣今日。統一更新按鈕傳入頁面所選日期。既有admin後端授權保留。未同步月份明確MONTH_NOT_SYNCED。Google調度鏡像整合各月份北倉資料並去除相同紀錄的重複快照。

## 路線分類歧義
主線、NDD、WHNDD來源類型明確時，在相同路線編號多個主檔候選中，先依既有業務分類核對。只有唯一候選才選用；來源類型空白／其他或同類仍多筆時維持待核對。不刪原始資料、不把重複來源列自動合併。每日需求與週期同步採同一判斷。

## 清單呈現
區分來源路線列、不重複路線、需求筆數、可選需求與待核對；避免路線數／車趟數混用。來源資料與已套用的週期需求分開。完整十車隊實際統計保存在工作區outputs報告，不將公司司機個資提交GitHub。

## 新增與修改檔案
server/staffingSourceModel.js
server/staffingSync.js
server/dailyFleetTasks.js
server/personnelSourceModel.js
server/personnelSources.js
server/platformSheetData.js
server/routes/operationSources.js
public/dailyFleetTasks.js
public/weeklyStaffing.js
public/staffingSync.js
public/personnelSources.js
public/unifiedSync.js
public/index.html
server/tests/staffing-source-model.test.js
server/tests/operation-source-model.test.js
server/tests/personnel-source-model.test.js
server/tests/personnel-source-sync.test.js
docs/PERSONNEL_SCOPES_AND_SOURCE_AUDIT_20261115.md

## 驗證與限制
本機模型31成功0失敗；作業UI14、週期UI10、人員UI8、統一同步UI13成功。資料庫整合測試在LinuxCI執行，涵蓋月份保存、實際司機新增、不覆蓋人工欄位、重複同步及稽核失敗回滾。
公司Web OAuth仍待匯入與本人授權，平台服務帳戶三個人員來源先前實測403；不宣稱真實自有司機或月班表同步已完成。排班需求不等於LINE報到，不自動扣款或計罰。正式環境不動、無付費資源、PR不合併。
