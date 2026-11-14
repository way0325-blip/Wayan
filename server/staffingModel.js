const dates=require('./dates');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function cycle(start){if(!dates.isValidDateKey(start)||dates.weekdayOf(start)!==2)fail('請選星期二作為週期開始日');return {start_date:start,end_date:dates.addDays(start,6),weekly_due_date:dates.addDays(start,-1)};}
function nextCycle(now=new Date()){const day=dates.todayInTaipei(now),week=dates.weekdayOf(day);return cycle(dates.addDays(day,(2-week+7)%7));}
function business(code,category){if(String(category).startsWith('上收'))return category;const prefix=String(code).split('-')[0];return ['NB','NJ','NC'].includes(prefix)?'主線':['FN','FM','FC'].includes(prefix)?'NDD':['WB','WD','WC'].includes(prefix)?'WHNDD':'類型待核對';}
function driverIndex(records){const map=new Map();for(const r of records){const key=String(r.externalDriverId||'').trim();if(!key)continue;const list=map.get(key)||[];list.push(r);map.set(key,list);}return map;}
function driverState(code,index){if(!code)return {valid:false,name:'',problem:'尚未填寫司機 ID'};const rows=index.get(code)||[];if(rows.length!==1)return {valid:false,name:'',problem:rows.length?'司機 ID 在名冊重複':'司機 ID 查無名冊'};const r=rows[0];if(!r.name||r.problems?.length||/停用|停派|離職|inactive|disabled/i.test(r.sourceStatus||''))return {valid:false,name:r.name||'',problem:'司機名冊資料或狀態待核對'};return {valid:true,name:r.name,problem:''};}
function project(row,index,now=new Date()){
 const today=dates.todayInTaipei(now),c=cycle(row.cycle_start),driver=driverState(row.driver_code,index),arranged=driver.valid&&!!row.fleet_name,weeklyLate=today>c.weekly_due_date,dailyLate=today>=row.service_date;
 const phase=row.cancelled?'cancelled':arranged?'arranged':dailyLate?'urgent':row.driver_code?'review':weeklyLate?'late':'missing';
 const labels={cancelled:'已停駛',arranged:'已安排',urgent:'需立即處理',review:'待核對',late:'待補齊',missing:'待填司機'};
 const filledDay=row.driver_filled_at?dates.todayInTaipei(new Date(row.driver_filled_at)):null;
 return {...row,driver_name:driver.name,driver_problem:driver.problem||(!row.fleet_name?'請指定車行':''),phase,label:labels[phase],complete:!row.cancelled&&arranged,weekly_late:!row.cancelled&&!arranged&&weeklyLate,daily_late:!row.cancelled&&!arranged&&dailyLate,filled_after_weekly_due:!!filledDay&&arranged&&filledDay>c.weekly_due_date,filled_after_daily_due:!!filledDay&&arranged&&filledDay>=row.service_date,daily_due_date:dates.addDays(row.service_date,-1)};
}
function summary(rows){const active=rows.filter(r=>!r.cancelled),missing=active.filter(r=>!r.driver_code),review=active.filter(r=>r.driver_code&&!r.complete);return {total:active.length,arranged:active.filter(r=>r.complete).length,missing:missing.length,review:review.length,incomplete:missing.length+review.length,urgent:active.filter(r=>r.daily_late).length,weeklyLate:active.filter(r=>r.weekly_late).length,routeCount:new Set(active.map(r=>r.route_uid)).size,driverCount:new Set(active.filter(r=>r.complete).map(r=>r.driver_code)).size};}
module.exports={cycle,nextCycle,business,driverIndex,driverState,project,summary};
