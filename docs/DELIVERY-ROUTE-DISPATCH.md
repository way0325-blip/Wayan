# 路線合計需求、車趟選擇與人工派車

路線合計需求沿用 shopee_routes.required_trucks；實際車趟透過 delivery_trips.demand_route_id 連結，每個連結車趟代表1車，可包含多筆跨區訂單。建立路線需求使用既有 POST /api/shopee/routes。既有未連結車趟仍沿用原流程。

蝦皮店到店新增路線需求入口、未出發車趟勾選、批次／逐車分派與LINE任務文字複製。勾選不修改資料，複製不發訊息，儲存分派也不發LINE。每批1～50車，可套用車隊群組後逐車改成自有司機及車輛，或待分派；需填原因。

夥伴車隊營運頁新增門店車趟區塊，按日期及車隊讀取同一份 delivery_trips，不複製資料。車隊派單由後端同步到既有 shopee_assignments；delivery_managed 標記由此流程維護的分派，變更數量後回到待回覆，不代替車隊承接。既有人工建立的承接量不能被此流程縮減覆寫。真實車隊仍須先設定可承接路線及容量；可先分派未綁定車隊供人工複製文字，但自動通知仍須驗證綁定。

新增API（登入且admin／dispatcher）：GET /api/store-delivery/dispatch-board?date=&fleetId=、GET /api/store-delivery/dispatch-options、POST /api/store-delivery/dispatch-plan。建立模擬資料 POST /api/store-delivery/demo-orders 另限admin及通過既有staging資料庫安全檢查。

008 migration只增加：delivery_trips.demand_route_id（FK）、is_simulated、索引及連結車趟單車檢核；shopee_assignments.delivery_managed；shopee_routes及partner_fleets.is_simulated。沒有刪表、刪欄或覆寫原資料。

分派使用既有transactionalRouter交易、870033路線鎖及870032司機車輛鎖、資料列鎖、精確updated_at版本。整批有錯即回滾；防止容量超額、重複司機車輛、無效群組、休假／證照及車型不符。已出發、已報到車趟不得調整；調整保留前後車隊／司機／車輛與原因。釋放舊資源前確認沒有其他未完成任務。路線總數包含自有車，避免車隊承接再超量。舊版承接連結仍要求用原流程修改。

查詢與寫入限流分開：GET最多600次／15分鐘／IP，保留control事件原有豁免；寫入維持300次／15分鐘，登入維持10次／15分鐘。大量查詢不再吃掉寫入額度，所有API角色驗證保留。

模擬資料：楊梅線20車、觀音線10車；30個待分派車趟，每趟2筆虛擬跨區訂單，共60筆。另有2個模擬車隊及2組自有司機車輛。地址明示虛擬、非真實蝦皮門店。固定is_simulated旗標阻擋LINE通知（佇列及送出前皆檢查），模擬車隊禁止寫入營運Sheets；修改備註不會解除。每日期建立／載入同一批，重送不重複。沒有自動扣款、計罰或真實派送。

選填測試啟動設定：STAGING_DEMO_ORDER_REQUEST_ID（UUID）、STAGING_DEMO_ORDER_DATE（YYYY-MM-DD）。兩者皆空時停用；僅通過staging檢查後以稽核交易建立上述模擬批次，重啟不重複。用於使用者授權的一次性測試資料初始化，完成後清空設定；不改密碼、Webhook或正式資料。

DOM驗收：scripts/verify-delivery-dispatch.mjs 只允許127.0.0.1:3081，透過真實API驗證勾選、混合分派、自有資源、複製警語、夥伴車隊同步與篩選。完整測試使用可重設的獨立測試叢集，禁止在含業務資料的本機3080或雲端執行重設。

限制：路線最多1000、車趟最多1000筆的管理看板需按日期／車隊縮小；其他既有清單仍有自身上限。這次不實作複製訂單資料或克隆使用中的車趟，複製是LINE文字。模擬資料僅作驗收，禁止作為實際營運輸入。未建立付費資源，正式服務及資料庫不變。
