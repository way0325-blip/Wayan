# 公司司機回填同步

僅獨立 staging；由既有服務帳戶讀取明確指定的10份公司表，不寫入來源，不發送LINE。公司帳號已能讀取10份；8份已核對服務帳戶reader權限，富詠與元佑倉共用遭Google拒絕，須獨立驗證平台讀取。

新增 GET /api/weekly-staffing/source-sync?start=YYYY-MM-DD 與 POST 同路徑（body.start），均沿用admin/dispatcher登入授權。新增 staffing_source_links 與 staffing_sync_state，保留來源位置、版本與每週同步報告。既有排班/異動鏡像會同步到私人營運Google Sheets。

每5分鐘讀取本週與下週，啟動15秒後首次執行；只在WAYAN_ENV=staging且既有Google憑證就緒時運作。Render Free休眠或停止時不保證執行，網站按鈕可手動更新選定週期。

第4列必須包含完整七天日期，第7列必須是路線編號/類型，A路線B類型C～K司機。保留ID前導零，空白建立待填需求；備援不建立路線；附加時間地區保留來源原文，只有主檔唯一對應才套用。重複路線不擅自選一筆；來源不含當週/無權限/格式變更時保留舊資料並顯示失敗。

人工已建立的安排、人工修改過的同步列、停駛列、不同來源占用、來源清空既有司機均列為待核對，不自動覆蓋或刪除。未知主檔不捏造路線；無效司機ID保持待核對，不算已安排。來源移除路線不會刪除歷史需求。

限制：未新增公司OAuth常駐權杖，不複製正式Secrets；無法讀取的表需擁有者授予平台服務帳戶檢視權限。同步時記錄的首次發現時間不是公司表實際填寫時間。介面確認為資料庫整合測試與DOM測試，手機實體驗收另行核對。

變更檔案：server/migrations/024_staffing_sources.sql、server/staffingSources.js、server/staffingSourceModel.js、server/staffingSync.js、server/routes/weeklyStaffing.js、server/index.js、public/staffingSync.js、public/index.html、server/tests/staffing-source-model.test.js、server/tests/weekly-staffing.test.js、本文件。
