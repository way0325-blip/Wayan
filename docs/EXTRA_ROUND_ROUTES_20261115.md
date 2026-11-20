# 北倉店配加出一輪

來源為既有路線資訊交換表，固定分頁北倉店配加出一輪、gid1667563176。唯讀讀取B/C/E/F/G/H/I/J，不讀D欄司機ID。新增尾碼-3與-4為獨立完整路線，不合併-1/-2。

沿用NB主檔模型：以B欄路線分組，E欄首列出車時段，G欄站序、H門店、I地址，保留全部站點與來源位置。其餘尾碼保留為待核對，不自行變更編號。與主要來源相同編號時保留主要版本並提示衝突；新增路線保留來源sheetId、sheetName、row。

每小時來源更新與全站統一更新沿用routeSourceRefresh管線。更新採增量版本與交易，不改已派車趟或歷史站點，不發LINE。補充來源格式／權限錯誤時不套用新批次。

另修正既有支援車趟合併時傳入的batch形狀，避免有有效支援列時發生records不存在。

修改檔案：server/extraRoundRoutes.js（新增）、server/routeSourceRefresh.js、server/tests/extra-round-routes.test.js（新增）、docs/EXTRA_ROUND_ROUTES_20261115.md（新增）。無API或資料表schema變更。

本機4項模型測試成功0失敗，涵蓋編號與時間保留、完整站點、主來源不覆寫、來源欄位與範圍唯讀。真實來源安全投影解析：46路線、454站點、0 blocked、0 issues，-3與-4各23條；不含司機ID。全套CI與雲端結果需以實際驗收為準。OAuth用戶端已接入測試服務，但Google本人授權未完成前，不宣稱來源已成功匯入。
