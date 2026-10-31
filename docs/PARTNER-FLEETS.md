# 夥伴車隊、LINE 多群組與 Google Sheets

本次以既有 Wayan 為基礎，新增「夥伴車隊營運」。每個車隊綁定一個 LINE 群組，同一個測試官方帳號可服務多個群組；任務、承接、異常案件均依綁定車隊隔離。此版本僅供獨立 staging 驗收，沒有部署正式環境或合併 PR。

## 已實作的工作流程

1. 新增車隊，維護聯絡窗口、電話、啟用狀態與每日車數上限，支援搜尋和分頁。
2. 管理員產生十分鐘有效的群組綁定碼，請信任的聯絡人在相應群組輸入。代碼只儲存雜湊，使用後失效，事件原文遮蔽代碼。
3. 建立車隊任務，填入日期、路線、車型、要求車數與備註；使用 requestId 防止重複提交。
4. 點「發送到群組」排入通知工作。同版本任務不重複排送，舊群組解除／改綁或任務狀態改變後不傳送過期通知。
5. 群組可查詢車隊任務，回覆承接、拒絕、到站、完成；承接車數不得超過要求車數或每日容量。
6. 群組可回報延誤、貨損、車輛異常、事故或其他異常。系統建立案件編號、原始回報與第一筆處理紀錄。
7. 管理端依「待處理 → 處理中 → 待確認 → 已結案」處理，可補充紀錄、指定處理人與登記結果。結案及重開限管理員。回報單可列印。
8. 車隊名冊、任務、案件與每筆處理歷程會排入 Google Sheets 同步；工作狀態區分待處理、傳送中、已送出、待設定、失敗、已取消。

一般車隊任務與原有蝦皮分派共用每日車隊容量，避免兩個入口各自超量。一般車隊任務與港口人車訂單是不同實體，不會自行修改司機車輛狀態；完整跨模組派車仍須另行驗收。

## LINE 指令

| 指令範例 | 行為 |
|---|---|
| 車隊群組綁定 管理員提供的代碼 | 將目前群組綁定到指定車隊 |
| 車隊任務 | 只列出這個群組所屬車隊的未結束任務 |
| 承接 T000001 2 | 確認承接 2 車 |
| 拒絕 T000001 原因 | 拒絕尚未回覆的任務，釋放預留容量 |
| 到站 T000001 | 已確認任務轉為執行中 |
| 完成 T000001 | 已確認或執行中任務完成；重複回報不重做異動 |
| 異常 T000001 說明 | 建立其他類型異常 |
| 延誤／貨損／事故／車輛異常 T000001 說明 | 建立指定類型異常；事故標示緊急 |

權限以已綁定群組為單位：該群組內可取得 LINE userId 的成員均可操作所屬車隊任務。群組管理員必須維護成員名單；這不是逐一司機帳號授權。原有私人司機 Bot 綁定及本人任務限制繼續保留。不能確認回報者的事件拒絕操作。

Bot 不能自行建立群組、加入群組或建立官方帳號。請在獨立測試頻道設定 Allow bot to join group chats，由群組成員邀請測試官方帳號，再使用綁定碼。不要將正式頻道的 Secret 或 Token 複製到 staging。

Webhook 必須是獨立測試主機可公開接收的 HTTPS URL；localhost 不能接收 LINE 伺服器事件。使用者目前選擇本機交付，因此本次沒有建立外網通道、雲端主機或正式部署。真實頻道與群組尚未驗收，不宣稱已邀請 Bot 或已送出真實群組訊息。

官方參考：[群組與多人對話](https://developers.line.biz/en/docs/messaging-api/group-chats/)、[推送重試鍵](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)。

## Google Sheets

新建的雲端表單包含：

- 營運總覽：啟用車隊、待回覆任務／車數、已確認承接車數、未結案與緊急未結案異常。
- 車隊名冊：車隊編號、聯絡人、電話、上限、狀態、群組綁定狀態及更新時間。
- 任務通知：任務、車隊、日期、路線、車型、要求及確認車數、狀態及任務名稱。
- 異常案件：案件編號、車隊、任務、回報時間、類型、嚴重程度、狀態、內容、處理人與處理結果。
- 異常處理歷程：不可由平台覆寫的逐次處理紀錄，包含操作者、狀態轉換及說明。

表單由已連接的 Google Drive 建立，時區設為 Asia/Taipei。新表單沒有真實營運資料，也沒有填入測試案例冒充資料。建立雲端表單不代表 Node 後端已取得持續寫入授權。

### 無人值守寫入的專用授權

後端使用獨立測試用的 Google service account，僅授予指定試算表寫入權限。不從聊天連線擷取 OAuth token，也不建立或複製正式環境金鑰。本次未建立 service account、Google Cloud 專案或其他資源。

在測試環境設定以下新增且明確宣告的變數：

| Node 變數 | 用途 |
|---|---|
| WAYAN_FLEET_SHEET_ID | 原生 Google Sheets 的 ID；管理端可儲存目標 ID 或貼上完整網址 |
| WAYAN_GOOGLE_CLIENT_EMAIL | 獨立測試 service account 的 email |
| WAYAN_GOOGLE_PRIVATE_KEY | 專用 RSA private key，僅保存在測試主機 Secrets／忽略的 .env.staging |

Compose 使用 `.env.staging.example` 中 STAGING_FLEET_SHEET_ID、STAGING_GOOGLE_CLIENT_EMAIL、STAGING_GOOGLE_PRIVATE_KEY 對映。金鑰以主機的秘密設定保存，不在聊天貼上，不提交 Git。測試主機需能連線到 oauth2.googleapis.com、sheets.googleapis.com 及 api.line.me。

未設定授權時，平台仍保存任務與異常，工作顯示「待設定」，不回報寫入成功。設定完成後可等待背景補送，或使用「同步全部紀錄」。帳號未獲該表寫入權限時會明確顯示權限錯誤。

### 重試及資料保護

- 任務及事件異動、稽核、案件歷程與同步工作在同一 PostgreSQL 交易內提交。
- 背景程序每十五秒最多處理三筆工作，以控制 Google API 呼叫量；這是最終一致同步，非每一筆都保證即刻送達。
- 工作有處理租約、最多五次失敗嘗試及人工重試入口。缺少設定不耗盡重試次數。無配置時不發出真實外部請求。
- LINE 推送使用固定 X-Line-Retry-Key；不確定回覆時沿用同一鍵，並辨識官方 409 已受理回應。超過 23 小時的安全窗口停止自動重試，要求人工核對。API 受理不代表群組成員已讀。
- Sheets 以持久的紀錄編號對應固定資料列，同一紀錄更新與重試覆寫原列，避免重複 append。寫入一律 RAW，回報中的等號文字不當作公式執行。
- 工作處理中若又有新異動，revision 會保留待同步狀態，避免舊工作錯誤標記新資料已同步。
- 寫入前檢查工作表、標題與原列的紀錄編號；欄位改名或資料列錯位時停止寫入，不覆蓋其他人的資料。
- 請用篩選檢視查閱，不要插刪、重新排序或改寫受同步表格的原始資料列及標題。這個版本尚未實作可隨任意排序移動的 row metadata。
- 欄位日期以可排序的數字日期寫入，電話及紀錄編號保留文字。當資料超出預留列數，後端延長格式並更新總覽公式範圍。
- 這不是 Google Forms 填寫入口。輸入來自 LINE 與 Wayan，Google Sheets 保存結構化表單及紀錄；如需獨立 Google Forms，需另定欄位與填寫流程。

官方參考：[讀寫儲存格](https://developers.google.com/workspace/sheets/api/guides/values)。

## API

所有管理端 API 都需要 JWT 及後端 admin / dispatcher 授權。

| 方法與路徑 | 用途／限制 |
|---|---|
| GET /api/fleet-ops/status | 統計與設定就緒狀態，不回傳金鑰 |
| GET /api/fleet-ops/fleets | 名稱／ID 搜尋及游標分頁，每頁 50 車隊 |
| POST /api/fleet-ops/fleets/:id/group-code | admin，產生群組綁定碼 |
| DELETE /api/fleet-ops/fleets/:id/group | admin，解除群組並撤銷舊碼 |
| GET /api/fleet-ops/tasks | 依車隊／狀態查詢與分頁，每頁 100 任務 |
| POST /api/fleet-ops/tasks | 建立任務，必須提供 UUID requestId |
| POST /api/fleet-ops/tasks/:id/notify | 通知排入工作，同版本防重複 |
| POST /api/fleet-ops/tasks/:id/cancel | 記錄原因；執行中／完成任務不可取消 |
| GET /api/fleet-ops/incidents | 依車隊／狀態查詢與分頁 |
| POST /api/fleet-ops/incidents | 管理端登記異常 |
| GET /api/fleet-ops/incidents/:id | 回報單與完整處理歷程 |
| PATCH /api/fleet-ops/incidents/:id | 處理狀態、處理人、結果及追加紀錄 |
| GET /api/fleet-ops/jobs | admin，最近 100 筆傳送／同步工作 |
| POST /api/fleet-ops/jobs/:id/retry | admin，重試失敗或待設定工作 |
| PUT /api/fleet-ops/sheet-target | admin，設定目標試算表 |
| POST /api/fleet-ops/sheet-resync | admin，將既有紀錄排入同步，保留唯一 job key |

## 資料庫與相容性

`002_partner_fleet_operations.sql` 僅新增 line_fleet_groups、fleet_group_codes、fleet_work_orders、fleet_incidents、fleet_incident_history、fleet_sheet_rows、fleet_delivery_jobs、必要索引與通知／名冊同步 triggers。保留既有表與欄位，不刪營運資料。

既有蝦皮路由延用原技術架構；每日容量查核加入一般車隊任務。已綁群組、有一般任務或已有雲端資料列的車隊禁止刪除，改用停用保留歷程。舊的未使用車隊若刪除，取消其待同步名冊工作。

共用交易路由在 HTTP 4xx 時也回滾，避免先寫一部分資料後才回覆業務錯誤。

## 驗證與未完成

測試使用另一個本機 PostgreSQL 實例、另一個資料目錄與 55449 埠，資料庫仍命名 wayan-staging-db；不使用目前本機平台 55439 的資料庫，也不連正式 DB。LINE／Google 外部 API 在整合測試中攔截，測試 RSA key 為臨時生成，無實際對外傳送。

已涵蓋群組隔離、代碼失效、任務去重、承接上限、LINE 不確定回應重試、案件歷程、狀態覆核、回報失敗回滾、Google 固定資料列與 RAW 防公式注入、欄位保護、擴充格式／公式、缺授權顯示、分派容量共用及 DOM 輸入安全。實際數量與執行結果見本次交付報告／CI。

尚待真實 LINE 測試頻道、各群組名單、HTTPS staging Webhook、專用 Google 後端寫入授權及真實手機／桌面視覺驗收。沒有自動建立官方帳號、群組、Google Cloud 資源或正式部署。照片附件、逐位群組成員的細分角色、跨任務車輛追蹤、已讀回執及 Google Forms 不在這次首版範圍。
