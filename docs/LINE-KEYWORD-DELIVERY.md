# LINE關鍵字與各車隊動態交付

日期：2026-11-01（台灣時間）。分支 staging/line-keyword-replies-20261101，基礎提交22ea4209b4c3db0b40eea267d6268e1a521054d5。

## 已完成

- 管理員關鍵字清單、新增／修改／停用、完整比對、內建指令保護、同交易稽核。
- 預設「說明、指令、報到、異常、事故、聯絡調度」。回覆適用全部已綁定車隊，不冒充營運處理成功。
- 每車隊接收狀態、群組動態、文字、Bot回覆、狀態、篩選、精確分頁、SSE與30秒補查。
- 事件歸屬保留原車隊，成員雜湊標記、不揭露Token；綁定碼不進動態。
- 收回訊息隱藏與原始訊息文字清除、先收回後原文的亂序防護。營運紀錄不因聊天收回而自動撤銷。

## 驗證

| 項目 | 通過 | 失敗 |
|---|---:|---:|
| lint語法檢查 |70|0|
| 單元／整合測試 |137|0|
| DOM介面流程 |20|0|

自動測試只用獨立本機55449叢集的wayan-staging-db，外部LINE呼叫皆模擬。包含權限、關鍵字、業務指令保護、稽核回滾、群組動態與篩選、綁定碼保護、收回事件、微秒分頁、HTML文字顯示、表單與即時更新。

使用者本機55439叢集先核對名稱及data_directory，再執行增量migration004；已載入6組預設回覆，保留既有資料。當次實際檢查：已觀察群組0、已綁定群組0、真實動態0。Bot加入群組不代表Webhook已連通，沒有用測試資料冒充真實群組動態。

## API與資料表

GET／PUT /api/fleet-ops/keywords 限admin；GET /api/fleet-ops/activity-status與activity限admin／dispatcher。migration004新增line_keyword_replies、fleet_line_activity及line_unsent_messages三表，無刪除既有表或欄位。完整說明見docs/LINE-ACTIVITY-KEYWORDS.md。

## 限制及未完成

- 真實LINE群組的隔離HTTPS Webhook、頻道測試金鑰及綁定仍待驗收；未使用提供過的Render網址、未發送真實群組訊息。
- 所有群組成員仍可操作該車隊；管理端admin／dispatcher可檢視所有車隊，尚無分區調度權限。
- 未回補既往聊天；圖片等只有類型標記，尚無附件下載或顯示名稱。未實作訊息編輯內容更新，動態不是完整聊天備份。
- 交易處理失敗的事件須由原有管理端事件紀錄檢查並重試，尚不會出現在動態投影。
- 未制定自動保留期限；正式營運前需確認保留政策。
- 關鍵字為平台Webhook設定，沒有更動LINE官方後台自動回覆。未知群組文字沿用原有指令說明回覆。
- 手機／桌面實際瀏覽器驗收尚未完成；DOM不是實機驗收。
- 未修改main、未合併PR、未部署正式環境、未連正式資料庫或複製正式Secrets、未新增付費資源。

## 新增及修改檔案（13個）

- docs/LINE-ACTIVITY-KEYWORDS.md
- docs/LINE-KEYWORD-DELIVERY.md
- public/index.html
- public/lineActivity.js
- public/lineKeywords.js
- server/fleetOperations.js
- server/lineActivity.js
- server/lineKeywords.js
- server/lineWorkflow.js
- server/migrations/004_line_keyword_replies.sql
- server/routes/fleetOps.js
- server/tests/control.test.js
- server/tests/line-keywords.test.js

本機配套另更新work/open-preview.mjs、outputs/start-wayan.cjs，新增work/install-local-keywords.cjs及更新DOM驗證腳本；非公開配套不納入來源PR。
