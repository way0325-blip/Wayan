# 當日00:00～24:00任務派車

選定日期以台灣日曆日計算：當日00:00含、隔日00:00不含，UI顯示當日00:00～24:00。24:00只作結束標示，不存成非法出發時間。每日日曆日午夜自動切換，手選歷史日期保持不變。

共用dispatchWindow供任務派車、夥伴車隊車趟、每日來源需求及Google每日需求鏡像使用。來源僅讀所選日期，不要求隔日欄位。時間未核對的當日需求仍保留待補，不混入另一日期。

GET /api/store-delivery/dispatch-board、/trips使用window=day；舊window=noon保留為同日模式相容別名，不再用舊跨日規則。路線合計需求也只取同日。無資料表或migration變更，不改寫既有車趟日期、歷史及LINE報到紀錄。

修改public/dispatchWindow.js、public/shopeeWorkspace.js、public/dailyFleetTasks.js、public/index.html、server/dailyFleetTasks.js、server/deliveryDispatch.js、server/routes/storeDelivery.js；測試operation-source-model、weekly-staffing、daily-fleet-dispatch同步更新。

本機模型14測試及每日任務UI13斷言通過，涵蓋午夜、23:59、隔日排除、閏日跨年及手動歷史日期。完整lint與資料庫測試由CI驗證。正式環境不變，不自動發布LINE。
