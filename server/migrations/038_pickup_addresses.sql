-- User-confirmed pickup addresses, 2026-11-20. Preserve historical trips and retired points.
INSERT INTO delivery_pickup_points(id,warehouse_id,name,box_type,address,active) VALUES
 ('CHANGRONG','DAYUAN','長榮倉','橘箱','桃園市大園區海口里建國路102號',TRUE),
 ('GUOJI','INTERNATIONAL_DOCK','國際倉','橘箱','桃園市大園區田心里國際路一段182號',TRUE),
 ('SHUIYUAN','DAYUAN','水源倉','橘箱','桃園市大園區橫峰里水源路906號',TRUE),
 ('RENMEI','YANGMEI','仁美倉','黑箱','桃園市楊梅區高榮里梅獅路395巷99號',TRUE),
 ('YANGMEI_SITE','YANGMEI','楊梅倉','黑箱','桃園市楊梅區上田里和平路576號',TRUE),
 ('WEISHI','YANGMEI','威獅倉','黑箱','桃園市楊梅區鎮興里梅獅路二段666號',TRUE)
ON CONFLICT(id) DO UPDATE SET address=EXCLUDED.address;
UPDATE delivery_warehouses SET selection_label='大園區（長榮／水源）',updated_at=NOW() WHERE id='DAYUAN' AND selection_label='';
