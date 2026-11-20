# 蝦皮店到店：取貨點與路線箱型

採用使用者確認的路線代碼邏輯，不取代訂單編號、門店代碼或既有自訂車趟編號。13筆代碼僅建立為選擇參考，不建立真實訂單，不猜測所屬門店／車隊。

| 開頭 | 配送類型 | 箱型 | 取貨區域／可選實際取貨點 |
| --- | --- | --- | --- |
| N | 店配 | 橘箱 | 大園：長榮倉、水源倉、大園倉 |
| F | 隔日到貨 | 橘箱 | 大園：長榮倉、水源倉、大園倉 |
| W | 黑箱隔日到貨 | 黑箱 | 楊梅：仁美倉、威獅倉 |

輸入路線後，新增訂單表單切換區域並限制取貨點選項；多個候選時仍由人工指定。新增單及CSV匯入均由後端驗證：路線有值即須選實際取貨點，區域與箱型須相符。相同取貨點可多路線、多訂單合併車趟；不同取貨點不可合併。箱型僅由代碼分類，不推算日期、不自行判定載重或路線需求車數。

CSV新範本8欄：訂單編號、取貨倉、門店代碼、作業日期、件數、備註、路線代碼、取貨點。取貨倉用既有大園倉／楊梅倉／觀音倉或ID，取貨點用上述五個名稱或ID。舊6欄CSV仍相容，不自動回填歷史。原三區域與觀音歷史紀錄不刪除。

訂單列表、車趟明細、車隊派單清單、LINE任務文字及CSV匯出呈現路線／取貨點／箱型。LINE文字保留原報到指令。車趟保留取貨點名稱、箱型及路線快照；不將大園區域地址猜測為長榮、水源或實際大園取貨點地址。五個地址皆待提供。

## 資料庫與API
增量migration 010新增delivery_pickup_points並建立五筆資料；delivery_orders新增pickup_point_id、route_code；delivery_trips新增pickup_point_id、pickup_point_name、box_type；delivery_trip_stops新增route_code。無刪欄、刪表或歷史更新。

GET /api/store-delivery/config新增pickupPoints、routeExamples；POST /api/store-delivery/orders/import接受選填routeCode、pickupPointId並驗證；POST /api/store-delivery/trips拒絕混合取貨點且寫入快照；既有查詢、LINE文字與日期匯出帶入新增資料。沿用登入、角色、交易、稽核及整批回滾。

## 檔案清單
- server/migrations/010_delivery_pickup_points.sql
- public/deliveryRouting.js
- server/routes/storeDelivery.js
- server/deliveryCheckins.js
- server/deliveryExport.js
- public/storeDelivery.js
- public/deliveryDispatch.js
- public/adminDelivery.js
- public/index.html
- server/tests/control.test.js（migration重跑與完整性檢查）
- server/tests/store-delivery.test.js
- scripts/verify-delivery-dispatch.mjs
- docs/SHOPEE_PICKUP_POINTS.md

## 驗收與限制
測試涵蓋13個代碼、五個取貨點、錯誤箱型／區域、批次回滾、跨取貨點拒絕、同點跨路線、LINE快照、CSV欄位及新單表單。未提供的倉庫地址、個別代碼實際門店與車隊歸屬仍待人工提供。舊資料保留空白分類，未擅自重算。僅獨立測試分支與測試環境，PR維持草稿不合併。已啟動的本機舊後端需重啟，才會套用migration並讀取新欄位。

最終驗證：lint 95項語法檢查通過；208項單元／整合成功、0失敗；50項DOM操作成功、0失敗。首次完整測試有1項舊migration數量固定為9的斷言失敗，改為實際檔案清單核對並檢查五取貨點後，完整重跑通過。157項既有規則保持待覆核。
