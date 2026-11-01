# Wayan獨立Render測試服務

僅供My Workspace（tea-dasqkjojo6nc73cvlbrg）獨立測試；不修改正式wayan-dispatch、不部署main、不使用已到期正式資料庫、不開通付費方案。

## 已核對資源

- 正式Web：srv-dat0e30jo6nc73doi3e0，main，Singapore，Free；保持不變。
- 原正式資料庫dpg-dasr1cu0tbcc738ljmjg-a已於2026-10-28到期並暫停。不要改接測試庫來冒充正式修復。
- 測試Postgres資源wayan-staging-db：dpg-dbiq06cs728c738089lg-a，Singapore，Available，PostgreSQL16，Free；實際庫名wayan_staging_db。到期時間2026-11-30 16:00台灣時間，來源expiresAt=2026-11-30T08:00:25Z（請以Render後台即時狀態為準）。

## 安全連線

預設仍只允許wayan-staging-db庫名。新增明確啟用的STAGING_RENDER_POSTGRES_ID設定，僅在值等於上述已核對資源ID、URL內網主機也完全相同、port為5432或省略、庫名為wayan_staging_db、WAYAN_ENV=staging時允許雲端測試。

不接受其他資源ID、正式主機、相似外部網域、任意庫名或連線參數覆寫host等；Render設定不能授權測試清除。原本本機測試限制保留。沒有資料表或API變更。

## 待建立的免費測試Web

- Repo：https://github.com/way0325-blip/Wayan
- 來源：本階段staging/render-staging-20261101分支，獨立草稿PR審查，不合併main。
- 建議新名稱wayan-line-staging，runtime Docker，plan free，region singapore，autoDeploy no；建立前先核對沒有同用途資源，避免重複。
- DATABASE_URL：只取上述測試庫Connect → Internal Database URL，不假設密碼或修改URL庫名。
- STAGING_RENDER_POSTGRES_ID=dpg-dbiq06cs728c738089lg-a，WAYAN_ENV=staging。
- JWT_SECRET及ADMIN_PASSWORD產生新的獨立測試值，前者至少32字、後者至少12字；不使用正式Secrets或展示密碼。
- LINE及Google設定只使用獨立測試憑證。尚無Google寫入授權時保留待同步，不宣稱已送達。

Render管理整合未提供連線密碼取得工具，SQL查詢因測試庫禁止外部連線被拒絕。保留限制，不開放0.0.0.0/0。本分支render.yaml使用fromDatabase引用既有wayan-staging-db的connectionString；沒有databases區段，不接管、建立或更改資料庫，不需要使用者複製密碼。Render官方允許引用同workspace中未列在Blueprint內的既有資源。

本檔是部署規格，不表示已建立或部署服務。新服務只有取得連線憑證、部署狀態live、健康檢查與LINE官方Verify成功後，才可切換測試頻道Webhook；切換前核對是否會取代其他用途。正式Web環境與資料庫一律不變。


## 套用與後續

部署入口：https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fway0325-blip%2FWayan%2Ftree%2Fstaging%2Frender-staging-20261101

使用My Workspace。畫面應只列一個wayan-line-staging免費Web服務、Singapore、指定staging分支；不要選正式wayan-dispatch。若顯示新增資料庫或付費方案，先停止。套用Blueprint是目前工具未提供的操作，須由帳號持有人在Render頁面確認一次，之後由管理工具追蹤部署。

render.yaml採JSON格式（合法YAML子集），可直接以JSON Schema檢查。採用官方2020-12 schema；結構驗證不等於平台建立驗證。

初次由Render產生新的JWT_SECRET及ADMIN_PASSWORD，不包含任何固定密碼；登入名稱wayan-owner，管理密碼在Render測試服務Environment內查看。若測試庫已有使用者，應使用既有測試帳號，初始化不會覆寫密碼。

初次不在Blueprint寫入LINE或Google密鑰，不要求你重新貼密鑰。服務建立後，管理工具只對新測試服務設定本機已提供的測試LINE憑證，必要時再部署測試分支。Google背景寫入憑證仍待取得，缺設定時保留blocked工作。不要將此階段誤認為LINE及Sheets已驗收完成。

官方依據：https://render.com/docs/blueprint-spec#referencing-service-properties 、https://render.com/docs/deploy-to-render#specifying-a-branch
