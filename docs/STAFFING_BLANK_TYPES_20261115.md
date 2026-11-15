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
