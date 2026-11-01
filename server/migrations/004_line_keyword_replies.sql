CREATE TABLE line_keyword_replies (
  keyword TEXT PRIMARY KEY CHECK(length(keyword) BETWEEN 1 AND 30),
  reply TEXT NOT NULL CHECK(length(reply) BETWEEN 1 AND 1500),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE fleet_line_activity (
  event_id TEXT PRIMARY KEY REFERENCES line_events(event_id),
  fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
  group_id TEXT NOT NULL,
  message_id TEXT,
  event_type TEXT NOT NULL,
  message_type TEXT,
  content TEXT NOT NULL,
  sender_label TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE line_unsent_messages (
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY(group_id,message_id)
);
CREATE INDEX fleet_line_activity_page ON fleet_line_activity(fleet_id,received_at DESC,event_id DESC);
CREATE INDEX fleet_line_activity_message ON fleet_line_activity(group_id,message_id);
CREATE TRIGGER wayan_activity_change AFTER INSERT OR UPDATE OR DELETE ON fleet_line_activity FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
INSERT INTO line_keyword_replies(keyword,reply,updated_by) VALUES
('說明',E'【Wayan 車隊服務】\n查詢蝦皮任務：蝦皮任務\n回報今日累計總車數：蝦皮報到 5\n查詢一般車隊任務：車隊任務\n輸入「報到」「異常」「事故」「聯絡調度」查看操作說明。\n請勿在群組提供密碼、Token 或 Secret。','系統預設'),
('指令',E'【操作指令】\n蝦皮任務\n蝦皮承接 S任務編號 趟數\n蝦皮拒絕 S任務編號 原因\n蝦皮報到 今日累計總車數\n一般車隊任務：車隊任務\n異常／事故說明：輸入「異常」或「事故」。','系統預設'),
('報到',E'【蝦皮報到】\n請回覆：蝦皮報到 今日累計總車數\n例如：蝦皮報到 5\n表示今天累計已報到5車，不是另外增加5車。相同總數重送不累加。\n須有今日已確認承接任務；誤報較高總數請聯絡調度，由管理員填寫原因更正。\n本訊息僅為操作說明，尚未登記報到。','系統預設'),
('異常',E'【異常回報說明】\n一般車隊任務請輸入：異常 T任務編號 異常說明\n例如：異常 T000001 車輛故障，請協助調度\n蝦皮S任務請聯絡調度，提供任務編號、路線、發生時間及說明，由調度登記處理。\n本訊息僅為操作說明，尚未建立案件。','系統預設'),
('事故',E'【事故處理說明】\n請先確認現場人員安全並聯絡調度。\n一般車隊任務可輸入：事故 T任務編號 事故說明\n蝦皮S任務請提供任務編號、位置、發生時間及說明給調度。\n本訊息僅為操作說明，尚未建立事故案件。','系統預設'),
('聯絡調度',E'請在本群組標記你們的調度窗口，提供車隊名稱、任務編號及問題說明。\n目前尚未設定專用調度電話；此關鍵字不會自動撥號或保證有人即時回應。','系統預設');
