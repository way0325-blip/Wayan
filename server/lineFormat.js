const { todayInTaipei, weekdayOf } = require("./dates");

const TYPE_INFO = { "船邊": "船邊:碼頭 → 貨櫃場", "CY": "CY:貨櫃場 → 客戶端" };
const TYPE_ORDER = ["船邊", "CY"];

function shortTime(t) {
  if (t && t.length >= 16) return `${t.slice(5, 7)}/${t.slice(8, 10)} ${t.slice(11, 16)}`;
  return t || "-";
}

// 與前端「複製明細」完全一致的排序與分組規則,並在每筆前加上可回報用的編號。
// 回傳 { text, numbering } — numbering 是 [{ seq, orderId }],供之後回報「N號完成」比對。
function buildDispatchText(orders, drivers, vehicles, opts = {}) {
  const today = todayInTaipei(opts.now);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][weekdayOf(today)];
  const title = opts.title || "調派明細";
  const lines = [`【${title}】${today.replaceAll("-", "/")}(${weekday})　共 ${orders.length} 筆`];

  const byShip = new Map();
  orders.forEach((o) => {
    if (!byShip.has(o.ship)) byShip.set(o.ship, []);
    byShip.get(o.ship).push(o);
  });

  const numbering = [];
  let n = 0;
  for (const [ship, items] of byShip) {
    const carrierNames = [...new Set(items.map((i) => i.carrier).filter(Boolean))].join("、");
    lines.push("", `🚢 ${ship}${carrierNames ? `(${carrierNames})` : ""}`);
    for (const t of TYPE_ORDER) {
      const its = items
        .filter((i) => i.dispatchType === t)
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));
      if (!its.length) continue;
      lines.push(`▶ ${TYPE_INFO[t]}`);
      for (const o of its) {
        const driver = drivers.find((d) => d.id === o.driverId);
        const vehicle = vehicles.find((v) => v.id === o.vehicleId);
        n++;
        numbering.push({ seq: n, orderId: o.id });
        lines.push(
          `${n}. ${o.container}　${o.size}`,
          `   ${o.from} → ${o.to}`,
          `   ${shortTime(o.time)}`,
          driver || vehicle
            ? `   司機:${driver ? driver.name : "-"}　車號:${vehicle ? vehicle.plate : "-"}`
            : "   尚未派車"
        );
      }
    }
  }
  if (opts.footer) lines.push("", opts.footer);
  return { text: lines.join("\n"), numbering };
}

module.exports = { buildDispatchText };
