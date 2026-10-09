const test = require("node:test");
const assert = require("node:assert");
const { todayInTaipei, toDateKey, addDays, daysBetween, daysUntil, isPastDate, weekdayOf } = require("../dates");
const { buildDispatchText } = require("../lineFormat");

// 台灣 = UTC+8。UTC 的 16:00 就是台灣隔天的 00:00。
// 之前的 bug 就發生在台灣 00:00~08:00(此時 UTC 日期還是前一天)。

test("todayInTaipei: switches to the next day at 16:00 UTC, including month and year boundaries", () => {
  assert.strictEqual(todayInTaipei(new Date("2026-10-08T15:59:59Z")), "2026-10-08");
  assert.strictEqual(todayInTaipei(new Date("2026-10-08T16:00:00Z")), "2026-10-09");
  assert.strictEqual(todayInTaipei(new Date("2026-10-08T17:30:00Z")), "2026-10-09"); // 台灣 01:30
  assert.strictEqual(todayInTaipei(new Date("2026-02-28T16:00:00Z")), "2026-03-01");
  assert.strictEqual(todayInTaipei(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
  assert.strictEqual(todayInTaipei(new Date("2028-02-28T16:00:00Z")), "2028-02-29"); // 閏年
});

test("addDays / daysBetween handle month, year and leap-year boundaries", () => {
  assert.strictEqual(addDays("2026-10-09", 1), "2026-10-10");
  assert.strictEqual(addDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(addDays("2026-03-01", -1), "2026-02-28");
  assert.strictEqual(addDays("2028-03-01", -1), "2028-02-29");
  assert.strictEqual(addDays("2026-10-09", -7), "2026-10-02");
  assert.strictEqual(daysBetween("2026-10-09", "2026-10-09"), 0);
  assert.strictEqual(daysBetween("2026-10-09", "2026-11-08"), 30);
  assert.strictEqual(daysBetween("2026-10-09", "2026-10-08"), -1);
  assert.strictEqual(daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("toDateKey normalises date strings and rejects garbage", () => {
  assert.strictEqual(toDateKey("2026-10-09"), "2026-10-09");
  assert.strictEqual(toDateKey("2026-10-09T09:30"), "2026-10-09");
  assert.strictEqual(toDateKey("not a date"), null);
  assert.strictEqual(toDateKey(""), null);
  assert.strictEqual(toDateKey(null), null);
  assert.strictEqual(toDateKey(20261009), null);
});

test("daysUntil is measured against the Taipei calendar day, not the UTC day", () => {
  const taipei0130 = new Date("2026-10-08T17:30:00Z"); // 台灣 10/09 01:30,UTC 還是 10/08
  assert.strictEqual(daysUntil("2026-10-09", taipei0130), 0, "台灣的今天到期");
  assert.strictEqual(daysUntil("2026-10-10", taipei0130), 1);
  assert.strictEqual(daysUntil("2026-10-08", taipei0130), -1);
  assert.strictEqual(daysUntil("2026-11-08", taipei0130), 30);

  const taipei2330 = new Date("2026-10-09T15:30:00Z"); // 台灣 10/09 23:30
  assert.strictEqual(daysUntil("2026-10-09", taipei2330), 0);
  assert.strictEqual(daysUntil("2026-10-10", taipei2330), 1);

  assert.strictEqual(daysUntil("garbage", taipei0130), null);
});

test("isPastDate: the expiry day itself is still valid, the day after is not", () => {
  const taipei0130 = new Date("2026-10-08T17:30:00Z"); // 台灣 10/09
  assert.strictEqual(isPastDate("2026-10-09", taipei0130), false, "到期當天仍有效");
  assert.strictEqual(isPastDate("2026-10-08", taipei0130), true);
  assert.strictEqual(isPastDate("2026-10-10", taipei0130), false);

  const nextDay = new Date("2026-10-09T16:00:00Z"); // 台灣 10/10 00:00
  assert.strictEqual(isPastDate("2026-10-09", nextDay), true, "過了台灣午夜就逾期");

  assert.strictEqual(isPastDate("garbage"), false, "無法判讀的日期不當成逾期");
});

test("weekdayOf", () => {
  assert.strictEqual(weekdayOf("2026-10-09"), 5); // 星期五
  assert.strictEqual(weekdayOf("2026-10-11"), 0); // 星期日
  assert.strictEqual(weekdayOf("2028-02-29"), 2);
});

test("dispatch text header shows the Taipei date and weekday even when the server clock is still on the previous UTC day", () => {
  const header = (now) => buildDispatchText([], [], [], { now }).text.split("\n")[0];
  assert.match(header(new Date("2026-10-08T17:30:00Z")), /^【調派明細】2026\/10\/09\(五\)/);
  assert.match(header(new Date("2026-10-08T15:59:00Z")), /^【調派明細】2026\/10\/08\(四\)/);
  assert.match(header(new Date("2026-12-31T16:30:00Z")), /^【調派明細】2027\/01\/01\(五\)/);
});
