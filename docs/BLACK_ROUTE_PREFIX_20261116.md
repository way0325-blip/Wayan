# 黑箱W開頭路線

黑箱共同接收群組將所有W開頭字母前綴路線歸為black，含WB、WD、WC、WSER、WWSER及後續W類型。非W開頭不因此歸為黑箱。橘箱既有前綴規則保持。每日任務的大群組提示沿用同一business函式，群組跨箱別檢查不變。

修改server/sharedLineGroups.js、public/index.html；新增shared-line-groups.test.js回歸案例。無API、資料表或migration變更。未自動綁定未識別群組，未發送LINE訊息。完整測試與lint交由CI，保留PR審查、正式環境不變。
