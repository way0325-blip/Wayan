# 每日來源更新失敗修正

根因：十家司機回填表實際A:J共10欄，舊讀取器要求至少11欄，因此所有來源STAFF_SOURCE_FORMAT，沒有讀取新值。改為至少9欄（路線、類型、7日），最多讀A:K，實際只有9/10欄則讀A:I/A:J。維持來源車行標題、路線及日期完整性檢查，不增加任意來源。

來源目前提供11/16～11/23八個日期，今日11/16仍可列入每日需求；11/17～23為完整下週。11/10～16的舊週不完整，不補造缺失日期。空白司機仍是待填需求。

另核對固定gid946527726名稱由北倉-店配路線規劃表變為北倉-店配路線規畫表。新增這一個已驗證別名，仍鎖定同一gid，讀取時使用實際名稱；未知名稱或不同gid繼續拒絕。

檔案：server/staffingSync.js、server/sourceCatalog.js、server/tests/weekly-staffing.test.js、server/tests/sourceCatalog.test.js。無API、資料表或migration變更。保留舊快照與車趟，未修改公司來源或發送LINE。完整lint及單元整合測試由CI驗證。
