# 桃園自有司機名冊修正

來源桃園配合中名冊確認為10位。名冊清單與系統司機新增改依完整桃園名冊，不再依選定日期班表篩選；日期仍用於運務士及調度班表。其他倉別保留於來源快照但不列入桃園名冊。

同步使用交易、司機工號唯一核對、逐筆稽核；重送不新增重複資料，同名異工號交人工核對。不覆蓋既有手動欄位、LINE綁定或歷史司機。系統舊資料另標示「系統司機資料（含歷史）」。

無API、資料表或migration變更。修改：server/personnelSourceModel.js、server/personnelSources.js、public/personnelSources.js、public/index.html；測試：personnel-source-model.test.js、personnel-source-sync.test.js。

本機模型11項與介面13項斷言通過；完整lint與資料庫整合測試由CI驗證。風險：來源重複ID、缺電話或無效證照不自動建立；既有同名不同ID不覆寫。正式環境維持不變。
