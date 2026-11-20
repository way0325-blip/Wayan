# 日期、路線、車隊及人工LINE公告

每日12:00至次日08:00依公司回填的真實日期與完整路線編號列出需求。來源ID、來源列、日期算出key，後端重新核對，不接受前端任意指定車隊。來源車行以dispatch_source_fleet_aliases對應partner_fleets，跨性質同編號不混用。

任務派車選取需求→核對取貨點與時間→預覽日期、路線與車隊→確認建立或建立並產生LINE文字；每車隊分開複製，由使用者貼至各車隊群組。不要求各車隊有Bot綁定，不建立LINE主動發送佇列。

Bot僅在已設定的橘箱／黑箱共同作業群接收任務、報到、退趟與異常並回覆。任務以實際fleet_id保留歸屬，共同群組不改變所屬車隊。畫面顯示接收大群組的實際設定，未設定明確提示，不依名稱猜測。沿用現有身分、日期、業務範圍、去重及Sheets回報機制。

路線清單更名路線資料庫，沿用source_catalog_batches及route_overrides，來源每小時更新並可由統一按鈕手動更新。保留增量版本、既有資料及人工調整，任務建立移到派車介面。

新增POST /api/source-catalog/daily/publish-text（admin、verified、rows、digest），同交易建立並指派車隊、稽核，再回傳各車隊複製文字。preview/commit新增staffingSourceKey、dispatchDay及車隊與接收大群組資訊。無新資料表或migration。沿用容量檢查，已人工改派的車趟不被覆蓋。

修改server/dailyFleetLinks.js、dailyFleetTasks.js、dailyTasks.js、sourceTripBuilder.js、routes/sourceCatalog.js；public/dailyFleetTasks.js、dailyTasks.js、shopeeIntegrated.js、index.html。新增daily-fleet-links.test.js、daily-fleet-dispatch.test.js。完整lint與資料庫測試由CI驗證，UI離線測試不送真實LINE。

限制：共同作業群須有Bot入群並核對實際群組及允許車隊，不能以提供的群組名稱推測ID。上收等其他性質不混用店配建趟。既有同日同路線重複資料保留待核對。