# 蝦皮店到店：三倉分區與多訂單車趟交付

日期2026-11-01（台灣時間）；分支staging/store-delivery-trips-20261101，基礎提交2aa1596e79408f543192044659ae02b585d9a0a1。

## 完成項目

- 原「訂單與車趟」入口改為「蝦皮店到店」，既有港口紀錄保留獨立入口、原資料與API。
- 三個取貨倉；本機大園倉載入使用者提供地址，楊梅與觀音地址留空待提供，沒有猜座標。
- 基隆、臺北、新北、桃園、新竹縣市77個行政區，不含宜蘭；分區查詢、官方門市地圖、地址地圖與逐段路線、可選參考底圖。
- 門店來源與核對、單筆／CSV門店及訂單匯入、資料庫實際串接、原子回滾、唯一訂單編號。
- 多筆跨區訂單合併一趟，限制同日同取貨倉；順序調整、門店及取貨地址快照、CSV明細。
- 司機車輛派遣、證照保養驗車及出勤檢查、跨港口／門店資源防衝突、逐站送達、完成釋放及取消重排保留歷程。
- 可連結既有同日同車隊已確認需求；確認趟數防超量、容量不重複計算、保護已連結需求歷程。
- LINE車趟通知outbox、固定重試鍵及過期版本拒送；群組「門店車趟」僅查本車隊D編號車趟。

## 驗證

| 項目 | 通過 | 失敗 |
|---|---:|---:|
| lint語法 |75|0|
| 單元／整合測試 |153|0|
| DOM介面流程 |28|0|

新增16項後端測試與8項門店DOM流程。涵蓋跨區合併、同倉同日限制、快照、重送、超量、重複訂單、全批回滾、順序、並行派遣、舊港口衝突、逐站完成、取消重排、LINE模擬通知與過期版本、需求連結、較大CSV本文。

測試只使用本機55449獨立叢集wayan-staging-db；外部LINE呼叫模擬，地圖不在DOM自動測試中對外載入。最後前端篩選調整另重跑28項DOM，全部通過。實際外部地圖、手機／桌面像素及真實LINE仍待驗收。

本機55439叢集先驗證current_database與data_directory後增量遷移及設定倉庫地址，未清除資料；實際門店0、門店訂單0，未灌入測試門店。

## API與資料庫

新增/api/store-delivery下config、warehouses、stores、orders、trips及停靠／派車／完成／通知等API。全部需登入與後端admin／dispatcher；門店及地址維護限admin。新增端點本文上限2MB，其餘API維持100KB。

migration005新增delivery_warehouses、delivery_stores、delivery_orders、delivery_trips、delivery_trip_stops五表；外鍵連結原車隊／司機／車輛／已確認需求；部分唯一索引防止訂單重複安排。沒有刪表或刪欄位。只追加尚未客製的系統預設LINE說明，保留管理員客製回覆。所有寫入同交易保存操作稽核。

## 限制與風險

- 需匯入或登錄真實已核對門店才能建立營運訂單；未自動取得官方全門店資料或虛構API。
- 一車趟一取貨倉、同日，跨倉取貨需分趟；同門店多張訂單保留各自停靠項目。
- 地圖為官方查詢入口、參考底圖及地址／逐段路線連結，沒有門店座標自動標記、最佳化、ETA、交通或貨車限制。
- 件數不等於載重，未推算重量與容積；資源為未完成任務鎖定，尚無未來時間區間預約。
- LINE真實HTTPS端點與群組綁定仍待驗收；D車趟送達由調度平台登記，私人LINE回報尚未新增。
- 獨立D車趟不增加原S需求的總車數報到上限；需要沿用時須選擇已確認需求連結。
- 門店1000、日訂單1000、日車趟500筆畫面限制，達上限會提示，統計依載入清單；需分區分日。
- 新門店配送數字在本頁，原儀表板仍是原港口資料；新門店／車趟Sheets專表與原生XLSX未實作。
- 新後端需重新執行本機啟動器載入；正式環境未修改，未合併PR、未部署、未複製正式Secrets或建立付費資源。

## 新增與修改檔案（18個）

- docs/STORE-DELIVERY-DELIVERY.md
- docs/STORE-DELIVERY.md
- public/index.html
- public/storeDelivery.js
- server/deliveryLine.js
- server/deliveryRegions.js
- server/fleetJobs.js
- server/fleetOperations.js
- server/index.js
- server/lineKeywords.js
- server/migrations/005_store_delivery_trips.sql
- server/routes/drivers.js
- server/routes/orders.js
- server/routes/shopee.js
- server/routes/storeDelivery.js
- server/routes/vehicles.js
- server/tests/control.test.js
- server/tests/store-delivery.test.js

配套另有work/open-preview.mjs、outputs/start-wayan.cjs、work/apply-local-delivery.cjs、work/delivery-preferences.json、work/install-local-delivery.cjs、work/delivery-dom.mjs及既有測試啟動器更新；私人倉庫地址未納入公開來源。完整操作、API及來源見docs/STORE-DELIVERY.md。
