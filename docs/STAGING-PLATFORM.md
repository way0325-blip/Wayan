# Wayan 個人營運控制平台：獨立測試版本

本分支以 `way0325-blip/Wayan` 為唯一基礎，保留 Express、pg、原生 HTML/CSS/JS、既有 API 與資料，不使用 Sites 的 Cloudflare runtime 取代 Node/PostgreSQL，也不發布任何正式網站。本次是可執行的增量版本，不代表八個階段全部完成。

## 安全界線

- 僅 `staging/personal-control-line-20261031` 分支；不修改 main、不合併 PR、不開啟自動合併。
- 本分支程式在建立 pg Pool 前要求 `WAYAN_ENV=staging` 且資料庫名稱必須為 `wayan-staging-db`；不符合立即拒絕。
- 資料庫名稱防護不能代替基礎設施隔離。運行者仍須確認連線主機、帳號與網路皆為獨立測試環境；不可把正式資料庫改名來繞過防護。
- 不讀取、複製或提交正式 Secrets。範例中的 STAGING_* 全是新增、明確宣告的測試配置，不代表遠端已存在這些變數。
- 沒有建立雲端資源、購買服務、配置正式頻道或部署；本機 PostgreSQL 測試實例不是已存在的遠端 staging 主機。
- migration 只新增資料表、索引、通知 trigger 與版本追蹤；保留既有資料表／欄位／資料。

## 第一階段：現況盤點

| 面向 | 來源與現況 | 本次處理 |
|---|---|---|
| 架構 | `server/index.js` Express；`server/db.js` pg；`public/index.html` 原生 UI | 保留架構，新增控制台資產及 API |
| 身分 | `server/auth.js` JWT，每次 API 查詢 active / role；users 僅 admin / dispatcher | 新 API 明確限制角色；司機透過獨立 LINE 綁定存取自己的訂單 |
| 資料結構 | users、drivers、vehicles、orders、settings、audit_logs、差勤、保養、蝦皮四表、LINE 日編號表 | 新增版本式 migration；未存取正式 DB，實際線上 schema 尚未核對 |
| 港口 | 現有船掛、船商、尺寸、作業時間、派車／改派／完成／強制狀態 | 多表派遣與完成改為交易、同交易稽核，加入休假及驗車阻擋 |
| 蝦皮 | CSV 匯入、候選車隊、自動分派、人工登記回覆；原先允許超額確認 | 驗證、寫入、稽核納入交易並序列化；阻擋併發超量、超額確認及低於承接量的需求縮減 |
| LINE | 原先驗簽後背景處理，沒有司機綁定／任務歸屬／去重 | 改為持久 inbox、私人對話、一次性綁定、本人任務、交易回報、失敗重試 |
| 測試 | 原先使用預設測試 DB 並直接刪表 | 禁止預設連線；限定明確授權的本機 wayan-staging-db；套件逐套順序執行 |
| 相依安全 | 初次 npm audit：1 high、2 moderate | 更新相容範圍內的 lockfile，保留 Express 4 架構；重新檢查見交付報告 |

既有 schema 的 CREATE/ALTER 與 seed 仍由 `initSchema` 管理，以免大範圍重寫造成相容風險；新的結構才由 `schema_migrations` 追蹤。既有種子資料是展示資料，不代表真實營運資料。

## 本次可使用的功能

- 個人營運控制台：今日港口總量、待派、執行中、完成、異常車趟；蝦皮需求／已確認／待回覆／缺車；司機與車輛可用率；事故待處理通知。
- 台灣日期及單一 SQL snapshot，避免多表 JOIN 重複加總需求車數。
- PostgreSQL NOTIFY → SSE → 瀏覽器同步。卡片約兩秒內合併更新；儀表板上的既有訂單列表最多三十秒合併更新，避免覆蓋使用者開啟中的表單。其他模組仍採既有操作後更新及手動重新整理。
- 連線中斷顯示狀態並重連；token 到期或角色停用後最遲下一次 20 秒心跳關閉 SSE；資料 API 每次都即時查驗權限。
- LINE 綁定碼 128-bit 隨機值，十分鐘有效，資料庫僅存雜湊；新碼使舊碼失效；已處理事件會遮蔽綁定碼。
- 指令：我的任務、統計、已完成、到站、完成、異常、事故、說明。
- 只接受私訊中的本人任務；未知或未綁定帳號不能讀取派車資料；群組指令只提示私訊，不洩漏任務。管理員主動推送到設定群組的既有功能仍保留，群組成員的可見範圍須由管理員管理。
- 異常／事故建立紀錄並將該車停派；管理端可以人工結案，但不自動恢復車輛可用。
- `webhookEventId` 去重，資料異動、回報歷程、稽核與事件完成狀態同交易；處理失敗回 503，支援 LINE 重送及管理員手動重試。
- LINE 回覆與 DB 無法形成共同交易。回覆失敗會記錄，已提交的作業不重做；司機可重發「我的任務」確認。沒有假裝具備外部訊息 exactly-once 保證。
- 原「N號完成」、部分櫃號模糊完成、全體任務統計及群組直接回報不再開放；改用私人對話中的訂單編號或完整櫃號，這是刻意的安全行為變更。

## 新增 API 與資料表

| API | 權限／用途 |
|---|---|
| GET `/api/control/summary?date=YYYY-MM-DD` | admin / dispatcher，整合統計；預設台灣今天 |
| GET `/api/control/events` | admin / dispatcher，Bearer header SSE，每人最多三條連線 |
| GET `/api/control/incidents` | admin / dispatcher，最近 100 筆異常 |
| PATCH `/api/control/incidents/:id/resolve` | admin，必填 resolution |
| GET `/api/line/admin/status` | admin，頻道是否設定、綁定清單與最近 50 筆事件；不回傳金鑰、LINE user ID 或事件原文 |
| POST `/api/line/admin/binding-codes` | admin，driverId，代碼僅當次回傳 |
| DELETE `/api/line/admin/bindings/:driverId` | admin，解除綁定並清掉未使用代碼 |
| POST `/api/line/admin/events/:id/retry` | admin，只重試處理失敗事件 |
| POST `/api/line/webhook` | 不走 JWT；必須通過原始內容 HMAC-SHA256 簽章驗證 |

`001_personal_control.sql` 新增 `line_driver_bindings`、`line_binding_codes`、`line_events`、`operational_incidents`、`order_reports`；migration runner 建立 `schema_migrations`。以外鍵、唯一鍵與 CHECK 維持一致性。舊資料若已有人車衝突，這次不任意修正，需另行盤點。新回報或事故已參照的訂單不得刪除，避免破壞歷程。

## 測試平台啟動

1. 使用本開發分支；不要使用 main 或既有正式 `.env`。
2. 複製 `.env.staging.example` 為 `.env.staging`，自行產生獨立 STAGING_DB_PASSWORD、至少 32 字的 STAGING_JWT_SECRET、至少 12 字的 STAGING_ADMIN_PASSWORD。
3. 本機可用：`docker compose --env-file .env.staging -f docker-compose.staging.yml up --build`。
4. 打開 `http://localhost:3080`。資料庫只綁定本機 55432，獨立專案與 volume；沒有使用既有 docker-compose.yml 或正式儲存空間。
5. 此啟動方式會先在這個獨立資料庫執行增量 migration。不要對有業務資料的 staging 主機執行測試重設。

未安裝 Docker 的主機可使用自行建立的獨立 PostgreSQL，明確設定 `WAYAN_ENV=staging`、`DATABASE_URL`（資料庫名稱必須相符）、`JWT_SECRET`、`ADMIN_USERNAME`、`ADMIN_PASSWORD` 再執行 `npm ci` 與 `npm start`。這些是既有環境變數與本分支新增 WAYAN_ENV 的明確設定要求，不能假設主機已配置。

## LINE 測試頻道接通

你已確認有獨立測試頻道。本次沒有取得或更動它的 Secrets，也未呼叫真實 LINE API。

1. 只在獨立測試主機的 Secrets 管理介面設定該測試頻道的 Channel secret 與 access token。Compose 使用 STAGING_LINE_CHANNEL_SECRET / STAGING_LINE_CHANNEL_ACCESS_TOKEN 對映為程式既有 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN。
2. 必須先有獨立測試主機的 HTTPS 網址，設定 Webhook URL 為 `https://<實際測試網域>/api/line/webhook`；這是格式範本，不是已建立的網址。現有 Sites 靜態部署不能代替這個 Node/PostgreSQL 後端。
3. 在 LINE Developers Console 驗證 Webhook，開啟 Use webhook 與 Webhook redelivery；可關閉重複的自動回覆設定。
4. 管理員登入 → LINE 司機平台 → 選司機 → 產生綁定碼 → 私下交給本人 → 司機加測試官方帳號好友並私訊綁定。
5. 以兩位測試司機分別驗收任務查詢、越權拒絕、到站、完成、異常、事故、解除綁定及重送。確認後台同步，且正式帳號與正式資料完全未受影響。

官方依據：[接收訊息、事件去重與重送](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Messaging API 參考](https://developers.line.biz/en/reference/messaging-api/)。Reply token 有有效期且不可任意重用，故不把人工事件重試當作保證補送舊回覆的機制。

## 自動測試

- `npm run lint`：延續專案原本語法檢查性質，現在涵蓋所有 server/public/scripts JS 與 inline script，並非 ESLint 風格規則。
- `npm test`：必須明確設定 WAYAN_ENV=staging、TEST_DATABASE_URL（本機獨立 wayan-staging-db）、ALLOW_STAGING_TEST_RESET=yes。測試會清空該 disposable DB 的 public schema，不能指向已在使用的 staging 營運資料。
- CI 僅使用獨立 PostgreSQL service，不使用 repository Secrets；本開發分支 push 或針對 main 的 PR 只執行檢查與測試，沒有部署步驟。
- 新測試涵蓋驗簽、綁定過期／撤銷／隔離、本人任務、重複事件併發、事故停派、稽核失敗回滾、重試、卡片統計、migration 重入、SSE、同車同人併發派遣與蝦皮跨路線超量防護。

## 尚未完成與風險

- 這不是完整營運驗收。尚未有真實測試頻道端到端驗收、遠端 staging HTTPS 主機、正式營運資料匯入或大規模壓力測試。
- A：獨立船期／航次實體、四種進出口作業分類、車趟區間衝突模型，仍須按實際業務流程擴充；現有 CY／船邊分類保留。
- B/C：正式請假申請核准、完整車籍載重、維修流程、四種網站使用者角色及逐筆權限尚未完成。
- D：現有 CSV 匯入保留，尚無 XLSX 匯入、合作車隊登入與自助回覆；目前由調度登記回覆。
- E：LINE 首版到站／完成／事故／異常／綁定已實作；尚無主動私人派車通知 outbox、定時自動重試 worker 與外部通知送達保證。管理端通知是站內即時通知，非另發管理員 LINE。
- F：完整規則版本、條款核對、主管責任、申訴與人工罰款尚未實作。控制台顯示「待建置」，不以零件數冒充；沒有自動計罰、扣薪或扣款功能。
- G/H：控制台已有實際數據；事件／事故列表目前有固定筆數上限，沒有分頁；備份還原尚需在目標 staging 平台演練。
- 既有 auth 仍以 localStorage 儲存 JWT；既有 inline script / unsafe-inline CSP 尚未全面重構。未宣稱完成滲透測試或所有資安要求。
- 既有非派遣 CRUD 仍沿用舊的 best-effort audit；本次新增回報／綁定／事故及派遣、蝦皮異動則為同交易嚴格稽核。其餘資料異動歷程仍需逐路由補齊。
- 派遣與蝦皮分別使用交易級 advisory lock，適合此增量版的安全優先策略；高併發需改為一致順序的人車／車隊細粒度鎖與壓力測試。直接 DB 寫入不受應用 advisory lock 保護。
- SSE 依賴常駐 Node 行程及 PostgreSQL LISTEN，反向代理須停用串流 buffering；Serverless／會休眠主機需另行驗證。
- 事件 payload 含 LINE 識別與營運資訊，API 不揭露原文；DB 管理權限、保存期限及清理排程仍須在 staging 確認。

## 備份與還原規劃

只規劃獨立 staging：先以 pg_dump 自 staging 匯出加密備份，確認無正式 Secrets；記錄 migration 版本、應用 commit、備份時間與校驗值。將備份恢復到另一個獨立 staging PostgreSQL 實例（仍命名 wayan-staging-db），驗證登入、訂單／司機／車輛／蝦皮數量、外鍵、綁定與稽核，再演練重跑 migration。未通過還原演練之前，不宣稱備份可用。保留頻率、保存天數、RPO/RTO 與存放位置需由使用者確認；本次沒有配置付費儲存或對正式系統執行 dump/restore。

## 後續增量順序

1. 審查本次分支及真實 LINE 測試頻道驗收，完成 staging 主機隔離證據。
2. 補齊逐路由嚴格稽核、角色矩陣、資料分頁、錯誤／備份還原與網頁資安。
3. 船期航次及四種作業分類、人車完整資料與請假核准。
4. XLSX 匯入、車隊自助登入與承接回覆、排程時段衝突驗收。
5. LINE 主動任務通知 outbox、重試 worker 與送達監控。
6. 人工核實的違規規則／案件／責任覆核／申訴裁決；禁止自動扣款。
7. 全模組數據及角色入口整合，完成桌面／手機、資安與業務驗收，持續以 PR 審查，正式發布另行處理。
