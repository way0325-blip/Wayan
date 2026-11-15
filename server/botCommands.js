const aliases={'接單':'接取','退單':'退趟','查任務':'車趟狀態','報到':'車趟報到','回報':'車趟異常'};
function normalize(text){const s=String(text||'').normalize('NFKC').trim();const m=s.match(/^(\S+)([\s\S]*)$/);return m?(aliases[m[1]]||m[1])+m[2]:s;}
const groupHelp='【任務操作】\n接單 任務編號 司機ID\n報到 任務編號\n查任務 任務編號\n退單 任務編號 原因\n改報 原任務編號 新任務編號 司機ID 原因\n回報 任務編號 延誤／車輛異常／貨損／事故／其他 說明\n\n完整站點請本人私訊：我的路線 任務編號\n先私訊Bot完成司機身分綁定。重複報到不重複計數；已出發退單須主管覆核。請使用公告完整任務編號，不只輸入路線名稱。';
const privateHelp='【司機私人指令】\n綁定 管理員提供的一次性代碼\n我的路線 任務編號\n我的任務／統計\n報到 任務編號\n退單 任務編號 原因\n接單請到指定作業群組；不得只靠司機ID驗證身分。';
module.exports={normalize,groupHelp,privateHelp};
