# 測試服務Web OAuth設定

在staging可選用WAYAN_GOOGLE_SOURCE_OAUTH_CLIENT_JSON，包含經驗證的Web OAuth JSON。用Render服務環境變數安全注入，不放程式庫、日誌、Sheets或測試資料。範例.env僅列空白名稱。

既有資料庫用戶端設定優先；沒有設定時才使用服務設定。格式與Web回呼網址驗證與既有匯入相同，無重設或刪除既有授權。Secret在建立OAuth2Client前透過既有Vault封裝；Google授權Refresh Token仍加密存DB。服務啟動只記錄keyReady/clientReady/configurationSource/connected布林與來源，不輸出Secret、Client ID或Token。

OAuth本人Google登入及同意仍需本人完成。回呼固定https://wayan-line-staging.onrender.com/api/google-sources/callback。公司來源僅spreadsheets.readonly；私人營運表寫入帳戶不變。

修改：server/googleSourceOAuth.js、server/index.js、server/tests/google-source-oauth.test.js、.env.staging.example及本文件。無migration、API變更、付費資源或正式服務變動。測試涵蓋env設定啟用、PKCE、無Secret外洩、錯誤JSON及保留既有設定。
