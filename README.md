# Wayan — 港區星際運輸調度中心

前端 + 後端全端版本,基於原本的靜態 HTML 展示版擴充而成。

- **前端**:純 HTML/CSS/JS(`public/index.html`),透過 `fetch` 呼叫後端 API
- **後端**:Node.js + Express
- **資料庫**:SQLite(使用 Node 22 內建的 `node:sqlite` 模組,無需額外安裝原生套件)
- **驗證**:JWT(登入後取得 token,存於瀏覽器 localStorage,之後每個 API 請求帶上)

## 本機啟動方式

```bash
npm install
cp .env.example .env
# 視需要編輯 .env(埠號、JWT_SECRET、初始帳密)
npm start
```

啟動後開啟 http://localhost:3000,使用 `.env` 裡設定的帳號密碼登入(預設 admin / 1234)。

開發時可用 `npm run dev`(Node 內建 `--watch`,存檔自動重啟)。

## 指令一覽

| 指令 | 說明 |
|---|---|
| `npm start` | 啟動正式伺服器 |
| `npm run dev` | 開發模式,檔案變更自動重啟 |
| `npm run lint` | 語法檢查(`node --check`) |
| `npm test` | 執行自動化測試(`node --test`,涵蓋健康檢查、登入、權限驗證、派車流程) |

## 環境變數

參考 `.env.example`。**請勿**把 `.env` 提交到 Git(已列在 `.gitignore`)。

| 變數 | 說明 |
|---|---|
| `PORT` | 伺服器埠號,預設 3000 |
| `DB_PATH` | SQLite 資料庫檔案路徑,預設 `./data/dispatch.db` |
| `JWT_SECRET` | JWT 簽章密鑰,**正式環境務必更換成隨機長字串** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 資料庫第一次建立時,種子管理員帳號的帳密 |

## API 一覽

| 方法 | 路徑 | 說明 | 需要登入 |
|---|---|---|---|
| POST | `/api/auth/login` | 登入,取得 JWT token | 否 |
| GET | `/api/orders` | 取得所有訂單 | 是 |
| POST | `/api/orders` | 新增訂單 | 是 |
| PATCH | `/api/orders/:id/dispatch` | 指定派車(含衝突檢查) | 是 |
| PATCH | `/api/orders/:id/complete` | 完成訂單 | 是 |
| GET | `/api/orders/export/csv` | 匯出訂單 CSV | 是 |
| GET | `/api/drivers` | 取得司機列表 | 是 |
| POST | `/api/drivers` | 新增司機 | 是 |
| GET | `/api/vehicles` | 取得車輛列表 | 是 |
| POST | `/api/vehicles` | 新增車輛 | 是 |

## 已知限制 / 尚未處理事項

- 目前僅有單一管理員帳號,尚未做多使用者、角色權限區分
- 未加上 rate limiting、CSRF 防護等正式上線前建議補強的安全措施
- 前端沒有拆成模組化的 build 流程(單一 HTML 檔案 + 原生 JS),適合展示,正式產品建議改用前端框架

