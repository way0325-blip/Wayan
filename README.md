# Wayan — 港區星際運輸調度中心

Node.js + Express + PostgreSQL 全端版本,基於原本的靜態 HTML 展示版擴充而成。

- **前端**:純 HTML/CSS/JS(`public/index.html`),透過 `fetch` 呼叫後端 API,依角色顯示不同操作權限
- **後端**:Node.js + Express,含安全性中介層(Helmet、速率限制、輸入驗證、CORS 白名單)
- **資料庫**:PostgreSQL(`pg` 套件)
- **驗證**:JWT(登入後取得 token,存於瀏覽器 localStorage),支援 **admin / dispatcher** 兩種角色
- **部署**:提供 Dockerfile 與 docker-compose(app + PostgreSQL)
- **CI**:GitHub Actions 自動執行 lint 與測試(含 Postgres service container)

## 角色權限

| 操作 | admin(管理員) | dispatcher(調度員) |
|---|---|---|
| 登入、瀏覽儀表板/訂單/司機/車輛 | ✅ | ✅ |
| 新增/編輯訂單、司機、車輛 | ✅ | ✅ |
| 指定派車、完成訂單 | ✅ | ✅ |
| 改派司機/車輛、批次匯入訂單、匯出 CSV | ✅ | ✅ |
| **刪除**訂單、司機、車輛 | ✅ | ❌ |
| 強制修改訂單狀態 | ✅ | ❌ |
| 後台管理:使用者(改角色/停用/重設密碼)、網站內容設定、操作紀錄 | ✅ | ❌ |

資料庫第一次啟動時,會依 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 種子出一個 **admin** 帳號。之後請透過「使用者管理」頁面(或 `/api/users`)新增其他帳號,不要繼續共用預設帳密。

## 本機啟動方式(不使用 Docker)

需要本機已安裝 PostgreSQL。

```bash
# 1. 建立資料庫
createdb wayan_dispatch

# 2. 安裝依賴
npm install

# 3. 設定環境變數
cp .env.example .env
# 編輯 .env,至少確認 DATABASE_URL 指向你剛建立的資料庫

# 4. 啟動
npm start
```

開啟 http://localhost:3000,使用 `.env` 裡設定的帳號密碼登入(預設 admin / 1234)。

開發時可用 `npm run dev`(Node 內建 `--watch`,存檔自動重啟)。

## 使用 Docker Compose 啟動(推薦)

```bash
cp .env.example .env
# 編輯 .env 設定 JWT_SECRET 等變數(docker-compose 會自動讀取)

docker compose up --build
```

會同時啟動 PostgreSQL 與應用程式,應用程式會等資料庫就緒後再啟動。開啟 http://localhost:3000 即可使用。

## 指令一覽

| 指令 | 說明 |
|---|---|
| `npm start` | 啟動正式伺服器 |
| `npm run dev` | 開發模式,檔案變更自動重啟 |
| `npm run lint` | 語法檢查(`node --check`) |
| `npm test` | 執行自動化測試(`node --test`),需要一個可連線的 PostgreSQL(見下方「測試」) |

## 測試

測試會連線到 `TEST_DATABASE_URL`(未設定時預設 `postgres://postgres:postgres@127.0.0.1:5432/wayan_dispatch_test`),每次執行前會先清空並重建 schema,確保結果可重現。

```bash
createdb wayan_dispatch_test   # 只需建立一次
npm test
```

測試共 15 項,涵蓋:健康檢查、登入、權限、派車與改派、輸入驗證、後台使用者管理與防呆、網站設定、批次匯入、調派類型與船公司、操作紀錄、CSV 注入防護、登入速率限制。

CI(GitHub Actions,見 `.github/workflows/ci.yml`)會在每次 push / PR 時,用一個臨時的 Postgres service container 自動執行 `npm run lint` 與 `npm test`。

## 訂單列表:調派類型、船公司、依船分組

「訂單與車趟」頁面為左右分割:**左半邊是訂單列表,右半邊是所選訂單的詳細資料與操作**(手機/窄螢幕會改為上下排列)。

- **調派類型**(必填):`船邊` = 碼頭 → 貨櫃場;`CY` = 貨櫃場 → 客戶端。列表可用上方按鈕篩選。
- **船公司**(必填):預設夏輝、陽明、天鵝湖,管理員可在「後台管理 → 網站內容設定」增減;也可依船公司篩選。
- **依船分組**:每一艘船(船名／航次)是一個可收合的群組,群組內再分成「船邊」與「CY」兩區,標題顯示船公司與筆數。
- 既有訂單升級後預設為 `CY`、船公司空白,請視需要編輯補上(編輯僅限「待派車」訂單,已派車者可請管理員先改回待派車)。
- 批次匯入 CSV 欄位:船公司、調派類型、船名航次、貨櫃編號、起點、終點、作業時間、尺寸。

## 後台管理(admin 專用,前端「⚙️ 後台管理」)

- **使用者**:新增、修改角色、停用/啟用、重設密碼、刪除。角色與停用狀態每次請求都以資料庫為準,**停用後立即生效**(舊 token 也會被拒絕)。不可停用/降級自己,也不可移除最後一位啟用中的管理員。
- **網站內容設定**:系統名稱、儀表板公告、常用地點(建立訂單時的建議清單)、船公司、貨櫃尺寸(訂單驗證以此為準)。
- **操作紀錄**:新增/修改/刪除/派車/改派/強制改狀態/批次匯入/登入都會記錄操作者、時間與內容(不記錄密碼),可依項目篩選。
- **訂單批次匯入匯出**:CSV 匯入採「整批驗證、任一列錯誤則整批不寫入」,一次最多 500 筆;匯出會對 `= + - @` 開頭的儲存格加前綴,避免 Excel 公式注入。

## 環境變數

參考 `.env.example`。**請勿**把 `.env` 提交到 Git(已列在 `.gitignore`)。

| 變數 | 說明 |
|---|---|
| `PORT` | 伺服器埠號,預設 3000 |
| `DATABASE_URL` | PostgreSQL 連線字串 |
| `JWT_SECRET` | JWT 簽章密鑰,**正式環境務必更換成隨機長字串** |
| `CORS_ORIGIN` | 允許的前端來源,多個網址用逗號分隔;留空則允許所有來源(僅建議開發環境) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 資料庫第一次建立時,種子管理員帳號的帳密 |

## API 一覽

| 方法 | 路徑 | 說明 | 權限 |
|---|---|---|---|
| POST | `/api/auth/login` | 登入,取得 JWT token | 任何人(有速率限制) |
| GET | `/api/orders` | 取得所有訂單 | 已登入 |
| POST | `/api/orders` | 新增訂單 | 已登入 |
| PATCH | `/api/orders/:id` | 編輯訂單基本資料(僅限「待派車」狀態) | 已登入 |
| PATCH | `/api/orders/:id/dispatch` | 指定派車(含衝突檢查) | 已登入 |
| PATCH | `/api/orders/:id/complete` | 完成訂單 | 已登入 |
| PATCH | `/api/orders/:id/reassign` | 改派司機/車輛(已派車/執行中) | 已登入 |
| PATCH | `/api/orders/:id/status` | 強制修改狀態 | **admin** |
| POST | `/api/orders/import` | 批次匯入訂單(JSON rows) | 已登入 |
| GET | `/api/settings/public` | 系統名稱(登入頁用) | 公開 |
| GET | `/api/settings` | 網站設定 | 已登入 |
| PUT | `/api/settings` | 修改網站設定 | **admin** |
| GET | `/api/audit-logs` | 操作紀錄(`?limit=&entity=`) | **admin** |
| PATCH | `/api/users/:id` | 改角色 / 停用啟用 / 重設密碼 | **admin** |
| DELETE | `/api/orders/:id` | 刪除訂單 | **admin** |
| GET | `/api/orders/export/csv` | 匯出訂單 CSV | 已登入 |
| GET | `/api/drivers` | 取得司機列表 | 已登入 |
| POST | `/api/drivers` | 新增司機 | 已登入 |
| PATCH | `/api/drivers/:id` | 編輯司機資料 | 已登入 |
| DELETE | `/api/drivers/:id` | 刪除司機(有進行中訂單則拒絕) | **admin** |
| GET | `/api/vehicles` | 取得車輛列表 | 已登入 |
| POST | `/api/vehicles` | 新增車輛 | 已登入 |
| PATCH | `/api/vehicles/:id` | 編輯車輛資料 | 已登入 |
| DELETE | `/api/vehicles/:id` | 刪除車輛(有進行中訂單則拒絕) | **admin** |
| GET | `/api/users` | 列出使用者帳號 | **admin** |
| POST | `/api/users` | 新增使用者帳號 | **admin** |
| DELETE | `/api/users/:id` | 刪除使用者帳號(不可刪自己/最後一位 admin) | **admin** |

## 安全性設計

- **密碼**:bcrypt 雜湊儲存,不存明碼
- **JWT**:8 小時過期,需在請求帶 `Authorization: Bearer <token>`
- **速率限制**:全站 API 每 15 分鐘 300 次;`/api/auth/login` 每 15 分鐘 10 次,降低暴力破解風險
- **輸入驗證**:所有寫入型 API(新增/編輯)皆有欄位必填、型別、長度、列舉值檢查,失敗回傳 400 與詳細錯誤訊息
- **CORS**:透過 `CORS_ORIGIN` 白名單限制允許的前端來源
- **安全性 headers**:使用 Helmet(含基本 CSP、不洩漏框架資訊等)
- **權限控管**:所有刪除、使用者管理端點皆限制僅 `admin` 角色可呼叫,伺服器端強制驗證,不僅依賴前端隱藏按鈕

## 部署準備

- 提供 `Dockerfile`(多階段、僅安裝 production 依賴)與 `docker-compose.yml`(app + PostgreSQL,含健康檢查)
- 正式環境請務必:
  1. 更換 `JWT_SECRET` 為隨機長字串
  2. 設定 `CORS_ORIGIN` 為實際網域,不要留空
  3. 更換或移除預設 `ADMIN_PASSWORD`,改用 `/api/users` 建立正式帳號
  4. 於 PostgreSQL 前面加上 TLS(視部署平台而定)、定期備份

## 已知限制 / 尚未處理事項

- 未做 refresh token 機制,JWT 過期後需重新登入
- 未加上密碼強度規則(僅檢查最短長度)
- 前端沒有拆成模組化的 build 流程(單一 HTML 檔案 + 原生 JS),適合展示,正式產品建議改用前端框架
- 未做分頁,訂單/司機/車輛數量很大時前端表格效能未特別優化
