# 規則、蝦皮總車數與群組設定：測試交付

日期：2026-10-31（台灣時間）。分支：staging/rules-shopee-checkin-20261031；基礎提交 d8dbecfbca022ee863d3fbf2cf43649e2279319a。

## 已完成

- 多群組清單、名稱與Group ID登記、簽章事件自動收錄、Bot離開解除綁定、群組狀態與失敗工作監控。
- 新增／編輯車隊時可選擇已驗證且未綁定群組；同交易保存與稽核。
- 蝦皮每日車隊要求趟數、已承接、累計報到總數、尚待報到；群組回報以總數取代累加，不要求車牌。
- 蝦皮承接／拒絕及通知outbox、重複事件防護、超量防護、管理員帶原因更正、追加歷程、SSE及30秒補查。
- 規則版本、來源、點數（含小數）、人工核實／停用；人工立案、主管確認、申訴與撤銷。無自動扣款、扣薪。
- 三個新Sheets工作表與固定列同步、完整重送；私人PDF資料不進公開GitHub。
- 本機獨立staging已增量遷移，載入157條私人草稿。157條初始資料已另以Google Drive連接工具寫入使用者原有試算表，仍為草稿。

## 驗證

| 檢查 | 通過 | 失敗 |
|---|---:|---:|
| 專案lint（語法） |65|0|
| 單元／整合測試 |127|0|
| 原車隊DOM流程 |6|0|
| 本次DOM流程 |9|0|
| 私人PDF草稿匯入 |157條|0|

資料庫自動測試使用獨立本機55449叢集wayan-staging-db；資料重設僅在該測試叢集。使用者本機55439叢集先驗證DB名稱與data_directory，再執行增量migration與冪等草稿匯入，未清除資料。

真實LINE及背景Google API在自動測試中模擬；已驗證初始157條Google原生資料、全為草稿與兩筆0.1點，沒有公式錯誤。實際手機／桌面瀏覽器、列印、群組報到及持續自動同步尚未驗收。

## API及資料表

詳見docs/RULES-SHOPEE-LIVE.md。新增/api/penalty-rules、/api/penalty-cases、/api/shopee-live；擴充/api/fleet-ops/groups、groups/import、fleets/:id/group；既有/api/shopee/fleets接受groupId並維持交易。migration003新增規則、規則歷程、個案、個案歷程、車隊累計回報、群組清單六表；擴充同步類別約束，無刪表或刪欄位。

## 尚未完成與風險

- LINE真實群組尚待邀請測試Bot、隔離HTTPS端點及手機驗收；既有Render URL未使用，未複製正式Secrets。
- Sheets初始資料已寫入，但持續背景同步仍需專用測試Google授權；未建立付費專案或資源。待設定／失敗工作保留，不能視為已送出。
- 群組狀態是最近事件證據，非LINE持續在線探測；群組所有成員均可回報該車隊，尚無個別成員職務白名單。
- 總車數只代表車隊當日回報值，不是車牌、GPS或個人出勤驗證；路線明細不分攤該總數。
- PDF人工轉錄須主管逐條覆核。檔名日期與頁尾更新日期不同，生效日未猜測。分級罰款、按箱、賠償、不認列運費等僅保存條件，無自動計算。
- 雲端同步依固定列，不支援手動排序或任意插入資料列；錯列與欄名變更會停止寫入。
- 公開原始碼不含私人PDF或條款json，其他電腦需另行提供私人資料。

## 新增及修改檔案（25個）

- docs/RULES-SHOPEE-DELIVERY.md
- docs/RULES-SHOPEE-LIVE.md
- public/fleets.js
- public/index.html
- public/operations.js
- public/penalties.js
- server/fleetJobs.js
- server/fleetOperations.js
- server/fleetSheetSchema.js
- server/fleetSheets.js
- server/importRuleDrafts.js
- server/index.js
- server/lineGroups.js
- server/lineWorkflow.js
- server/migrations/003_rules_shopee_checkin.sql
- server/routes/control.js
- server/routes/fleetOps.js
- server/routes/penaltyCases.js
- server/routes/penaltyRules.js
- server/routes/shopee.js
- server/routes/shopeeLive.js
- server/shopeeCheckins.js
- server/tests/control.test.js
- server/tests/rules-shopee-live.test.js
- public/control.js

本機配套檔案另有work/open-preview.mjs、outputs/start-wayan.cjs、work/private-rule-drafts.json、work/install-local-rules.cjs、outputs/Wayan-LINE群組設定指南.md、outputs/Wayan-LINE群組匯入欄位.csv及outputs/Wayan-PDF條款核對.md。配套與私人資料未納入公開PR。
