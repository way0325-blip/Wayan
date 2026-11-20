# 展開式營運介面與出勤雙向同步

## 現況判斷及本次實作

保留Express、PostgreSQL、既有LINE webhook、SSE即時事件與持久工作佇列。現階段的問題主要是畫面重複、相同勾選狀態分離、建立與修改用途混在一起，以及出勤沒有可追溯的Sheets回寫。這次不重寫系統、不刪資料表或歷史資料，而是修復這些具體問題。

所有主要功能採原生details／summary：預設收合、標題摘要、可個別展開，也可整頁全部展開／收合。僅保留日期、待辦與關鍵摘要在外層。展開偏好只在本機儲存布林值，不保存任務、人員或訊息內容。捷徑會展開對應模組。表單與彈窗不再額外套多層收合。

導航維持每日營運、風險與資源、系統管理。蝦皮日常流程使用車隊清單→車趟明細；來源路線與匯入是建趟工具，不混成每日已派任務。原始訂單進階區明確分成「待安排訂單：合併建立新車趟」與「已建立車趟：批次調整與報到代號」。已安排訂單不可重複合併，僅供查閱；待安排訂單有全選，既有車趟勾選與主車隊清單共用狀態。

LINE發布簡化為勾趟→車隊列發布→確認群組送出。顯示目標群組、趟數、路線與時間，完整文字預覽可自行展開；取消額外勾選確認框。仍保留後端版本與群組核對、模擬資料阻擋、去重、稽核、重試與可複製文字。排隊不代表送達。

## 出勤與班表

沿用既有driver／dispatcher及出勤／休假／曠職，沒有假設未建立的工時／輪班時段。平台月曆點選可改狀態，姓名下顯示平台人員ID；來源名冊的外部司機ID未必相同。平台更新採交易、版本、稽核及工作佇列，Google輸出與回寫也走同一驗證。清除保留同步版本，防止舊Sheet重建已清除的紀錄。

營運試算表新分頁「出勤與班表」：A～H系統目前值，I～N黃色提交欄，O～P結果。I變更出勤：出勤／休假／曠職／清除；J備註空白沿用，（清空）清除；K～M在新增時填driver或dispatcher、現有人員ID、日期；最後增加N提交序號；每次新序號會套用本次非空的變更欄，送出前請核對黃色欄內容。相同序號不重做，重複系統ID不套用，刪除顯示列不等於刪除平台資料。服務運作時約30秒讀取，每次最多處理50筆新提交；保留已提交原文，不清空使用者輸入。

同人同日兩邊同改會留下待核對紀錄，管理員比較後保留平台或採用Sheet。僅有試算表編輯權限的人能送出變更，來源稽核標示Google Sheets提交，不冒稱知道實際編輯者身分。Google表不是排程資料庫的替代品，最後成功時間與錯誤會顯示於平台。

## API與migration

PUT /api/attendance新增必填expectedVersion；新紀錄為null。GET原月份接口保持staff及records，另加versions（含已清除紀錄）。後端限admin／dispatcher；同步覆核與重試限admin。
GET /api/attendance/sync-status；GET /api/attendance/sheet-requests；POST /api/attendance/sheet-sync；POST /api/attendance/sheet-requests/:id/resolve（verified、choice、expectedVersion）。
017增量新增attendance_sync_state與attendance_sheet_requests及同步trigger；現有attendance_records資料保留，原有清除操作保留tombstone及稽核。不新增Secrets、付費服務或正式環境變更。

## 企業公開資訊的借鏡與界線

- 蝦皮官方說明以查詢編號及最新配送狀態追蹤，借鏡為清楚的任務／路線編號與狀態。https://help.shopee.tw/portal/4/article/80118
- Coupang公開LOC職務說明重視營運指標、儀表板與差距／根因分析，借鏡為待辦優先及數據口徑一致。https://www.coupang.jobs/tw/jobs/8311782/senior-business-analysis-logistics-operation-center/
- 新竹物流公開API貨況對應表區分正常配送與各種異常，借鏡為狀態／異常／處理歷程分離。https://cagweb01.hct.com.tw/Report/API服務說明_V1.pdf
- 黑貓公開貨態說明區分配送、轉運、送達及調查處理，借鏡為明確狀態名稱與例外處理。https://www.t-cat.com.tw/inquire/explain.aspx

以上為公開服務／職務／API文件，不代表取得企業內部架構、授權或已串接其資料。未抓取客戶包裹、人員或登入後內容。

## 缺口與暫不加入的項目

需後續提供正式來源才能落地：各承運商授權API／資料契約、時效承諾與逾時規則、工時／輪班規格、簽收證明／影像保存規範、運價與對帳結算、真實GPS資料來源。這些沒有被做成假功能。先保留可擴充界面與清楚狀態；不將包裹件數混入按趟計價，不自動計罰或扣款。

現有Free服務仍可能休眠、同步非全天候每秒保證；資料庫到期與正式上線規劃仍需另行處理。名冊、出勤、任務與罰款的Google同步方向仍以「資料同步說明」為準，不能宣稱全平台所有資料皆雙向。
