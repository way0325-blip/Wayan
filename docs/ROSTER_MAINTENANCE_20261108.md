# 雲端名冊新增、變更及Google雙向同步

2026-11-08；僅測試環境。

## 平台

雲端司機與雲端車輛名冊的私人快照入口改為新增，資料列提供變更按鈕。管理員才可寫入，調度可讀取。儲存採版本核對、交易、完整新快照及before/after稽核；舊資料不覆蓋。姓名與ID變更受LINE身分保護；電話及證照期限可維護，提醒立即重算。

## Google操作

Wayan車隊營運紀錄新增司機名冊、車輛名冊及資料同步說明。原始交換表保持只讀，舊司機_北等分類頁是來源快照，雙向入口是新名冊。

1. 藍色目前資料與隱藏紀錄ID／讀取版本由系統維護。
2. 在黃色變更欄輸入修改；空白沿用，填「（清空）」清除可選欄位。
3. 每次送出填入遞增正整數提交序號，如1、2、3。舊序號不重做，已套用的舊欄位值不重複覆寫。
4. 新增使用空白列，司機至少填司機ID及姓名；車輛至少填車牌與車型，再填序號。證照未提供可存成待核對，但不能直接綁定接取。
5. 服務運作時約每30秒讀取。平台儲存會排入Google輸出工作，成功後顯示最後時間。輸入欄不由系統清空，未提交草稿保留。
6. 兩邊同改一筆時不自動覆蓋。在平台查看待核對變更，勾選核對後選保留平台或採用Sheet；版本已更新時需重新核對。Sheet刪除顯示列不等同刪除平台資料，重複系統ID不套用。

## 架構及API

既有source_catalog_batches保留版本，新增JSON rosterUid作穩定同步識別。增量migration016新增roster_sheet_requests，保存提交去重、內容、版本、衝突與結果，不刪除原欄位或資料。Google資料透過既有outbox與服務帳戶，RAW寫入使用者內容；僅可信提醒公式使用USER_ENTERED，系統不覆寫黃色輸入區。

新增POST /api/source-catalog/:kind/entries及PUT /:kind/entries/:sourceRow（完整前綴相同）；kind為drivers或vehicles，record、expectedBatchId、verified，變更另需recordKey。
GET /:kind/sheet-requests管理員查待核對；POST /:kind/sheet-sync重試；POST /:kind/sheet-requests/:id/resolve接受choice=platform或sheet、expectedBatchId、verified。讀取名冊回傳sheetSync狀態。

## 覆蓋範圍

完整支援方向見DATA_SYNC_MATRIX_20261108.md及Google資料同步說明。司機／車輛新名冊本次雙向；異常、罰款、接取／報到等既有流程主要為平台到Sheet單向輸出。每日訂單／所有派車、出勤、維修、自有派車資源尚非完整Google雙向。LINE一般聊天動態不會全部輸出成異常或表格。

## 驗證與限制

完整後端306成功／0失敗；同步專項13及表單／衝突畫面12通過；既有來源UI27通過，lint129語法檢查通過。專項為重跑，不重複加總。Google實際往返驗收結果另記交付報告。

Free服務休眠、網路及Google API失敗會延遲，不是全天每秒同步。同步狀態成功前不聲稱完成；失敗保留重試。Google可編輯者具有提交資料權限，未新增分享權限；系統欄請勿改寫或在同步中搬移整列，黃色輸入區不被輸出覆蓋。刪除不同步；錯誤或身分限制需人工核對。版本與提交歷史會增加儲存量，未自動清除。未自動建立自有派車資源、派車、計罰或扣款。正式服務、正式DB、main不變，維持Free，不合併PR。
