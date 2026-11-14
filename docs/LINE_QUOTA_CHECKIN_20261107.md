# LINE十次報到用量驗收

僅獨立staging測試，不變更正式環境、方案或付款方式。使用STAGING_ROUTE_ACCEPTANCE_NO_PUSH=yes搭配既有一次性測試request/date/fleet旗標，建立一筆有明確模擬警語的當日車趟。此模式不建立LINE push job，也不建立模擬資料可推播的授權。

測試需由使用者的LINE帳號在已綁定群組分開傳10則「車趟報到 測試代碼」。預期首則成功、其餘9則未重複計數。Bot僅用Reply API回覆；一人每趟仍只計1車。不能用Bot推送給自己或偽造外部Webhook代替真實手機驗收。

先記錄GET /v2/bot/message/quota/consumption與quota，測試後再讀取並追蹤更新延遲；若期間有其他Push，須排除混用影響。部署前初次讀取為totalUsage=2、quota=200；正式測試基準以要求手機發送前的讀值為準。

STAGING_QUOTA_CHECKIN日誌只記指定已核准模擬車趟，包含事件／帳號雜湊、處理狀態、回覆狀態、設定是否齊備、報到總數與是否去重；不輸出LINE userId、群組ID、reply token、訊息內容或Secrets。已處理事件重送不重複記錄診斷。一般任務不記此驗收日誌。

新增設定值、診斷helper及來源整合測試；無API或schema變更。34項來源／不推播測試通過，lint與GitHub CI另列交付。測試旗標建立車趟後清空，紀錄保留。
