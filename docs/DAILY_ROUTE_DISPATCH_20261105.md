# 蝦皮每日路線任務與LINE派單

本分支只用獨立測試資料庫與測試服務；main及正式環境保持不變。

## 操作
1. 蝦皮店到店：選N/F/W性質、出車時段、配送區域或車型，亦可搜尋路線編號。
2. 每日任務匯入：下載CSV範本。欄位serviceDate,routeCode,pickupPointId,departureTime,quantity。CSV、TSV、JSON陣列或Google Sheets分頁連結共用相同驗證。Google A～E欄須使用相同標題、日期YYYY-MM-DD、時間HH:mm，分享檢視權限給平台既有服務帳戶。每列代表完整已同步路線、1趟、需求1車；quantity是每站件數，須人工核實。
3. 每批1～100路線，預覽後勾選核對才建立。任一列衝突整批回滾；同日同路線同內容重送回傳既有車趟。來源版本或內容變更必須重新預覽。
4. 切換作業日期，勾選1～50車趟，選車隊群組或自有司機／車輛後儲存，可在出發或報到前調整。
5. 分開提供「複製所選車趟至LINE」及「確認由BOT發送所選任務」。後者再次確認後排入既有重試佇列，佇列成功不是手機送達證明。
6. LINE群組：車趟報到 NB-...（實際路線編號）。只匹配今日已指派該車隊、全部有效停靠站皆相同路線的唯一車趟；若同路線多趟，改用完整日期任務碼。既有楊梅1等代號仍可用，每人每趟一次，名額不可超收。

## API與資料
- POST /api/source-catalog/daily/preview：檢核每日rows並回傳版本摘要。
- POST /api/source-catalog/daily/link：僅讀取HTTPS docs.google.com的指定試算表gid，不抓任意URL；Google授權僅readonly，最多100列。
- POST /api/source-catalog/daily/commit：管理員核對及digest驗證，交易式建立車趟、訂單、停靠站、來源連結與稽核。
- GET /api/source-catalog/:kind：新增area、vehicleType篩選，在分頁前篩選；蝦皮路線不回傳來源司機編號。
- POST /api/store-delivery/trips/batch-notify：登入調度／管理員、1～50唯一tripId與精確版本；任一失敗整批撤銷佇列。
- 既有來源建趟API共用sourceTripBuilder，保留全部站點、排序及idempotency。
- 無資料表／欄位刪除，無需新migration。既有來源快照保留，新讀取不再要求D欄司機編號。

## 安樺驗收
僅staging、日期等於台灣今日、已驗證綁定且Bot仍在群組，才可啟動一次性驗收。非敏感設定STAGING_ROUTE_ACCEPTANCE_REQUEST_ID / DATE / FLEET_ID / FLEET_NAME透過Render服務層合併寫入，不取代Blueprint或既有Secrets。使用已同步且無問題的隨機路線快照建立1個獨立*-TEST-*任務，不占用正式來源每日路線連結。測試件數1、23:59均為明確虛擬驗收值；顯示模擬警語，不可出車、計罰。settings記錄request防重送及23小時的指定trip/fleet推送許可；一般模擬車趟仍禁止外送。完成後清空啟動request旗標。測試異常仍禁止寫入營運Sheets。

## 驗證與限制
完整回歸253通過0失敗；新增最後重點回歸51通過0失敗（含重跑項目）；Google讀取單元測試2通過0失敗。舊功能DOM61通過、新來源與每日匯入DOM23通過。最終lint與雲端結果另列交付紀錄。
DOM測試驗證JavaScript、HTTP與資料庫，不等於真實瀏覽器視覺驗收。真實個人帳號報到與手機收訊須由使用者觸發。未知外部供應商API／任意檔案格式尚未接入；目前有明確標準資料契約及手動匯入，不宣稱定時自動同步。來源路線異動仍須管理員確認後同步。
