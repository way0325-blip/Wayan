# Wayan 獨立測試資料庫規劃

## 決策
目前不建立雲端付費資料庫，不連接正式 Render / PostgreSQL，不複製正式 Secrets。第一步採 GitHub Actions 的 PostgreSQL 16 service container 作為一次性測試資料庫，資料庫名稱固定為 `wayan-staging-db`。此名稱僅代表 CI 內的臨時資料庫，不代表已建立持久雲端資料庫。

## 既有 CI 現況
`.github/workflows/ci.yml` 已有 PostgreSQL 16 service，現用資料庫名稱 `wayan_dispatch_test`，設定 `TEST_DATABASE_URL`，並執行 `npm ci`、`npm run lint`、`npm test`。現有測試程式碼尚需逐一檢查是否有其他 DB URL fallback 與破壞性 schema 重建操作。不可直接將既有 CI 視為已符合所有隔離要求。

## 建置條件
1. 僅在開發分支修改 CI；不修改 main。
2. CI 中建立 PostgreSQL 16 service，使用獨立、短生命週期資料庫 `wayan-staging-db`。
3. `DATABASE_URL` 和 `TEST_DATABASE_URL` 都必須顯式指向同一個臨時測試服務；不得回退至正式連線字串。
4. 增加測試啟動前保護：驗證主機為 localhost / service host、資料庫名稱完全符合 `wayan-staging-db`，並在破壞性測試前再次驗證。不得僅靠環境名稱字串判斷。
5. 禁止將 Render Secrets、LINE 正式 token、正式 PostgreSQL 連線字串帶入 CI。
6. CI 權限最小化，避免使用 production deployment environment，避免觸發正式部署；檢查既有 workflow 與 branch protection。
7. 在確定所有測試僅使用隔離 DB 後才執行 lint、單元測試、整合測試，回報成功/失敗數量。
8. CI 執行完成後 service container 自動銷毀，資料不持久保存。
9. 若未來需要可長期保留的 staging DB，先評估免費額度、休眠、備份、保留期限與隔離策略；任何可能產生費用的資源都必須另行取得明確核准。

## 驗收標準
- `main` 無變更，正式網站未部署。
- 測試 DB 無正式資料及 Secrets，測試前置保護能拒絕未知主機或 DB 名稱。
- CI lint 與測試通過，測試數量與失敗原因可追溯。
- 開發分支保留 PR 人工審查，不自動合併。

## 目前狀態
僅完成規劃文件；尚未修改 workflow，尚未建立或連接任何資料庫，也尚未執行測試。
