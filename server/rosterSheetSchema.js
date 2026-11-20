const {SOURCE_ID,hash}=require('./sourceCatalog');
const fields={drivers:['externalDriverId','name','phone','vehicleType','licenseType','license','warehouse','sourceStatus','employeeId'],vehicles:['plate','vehicleType','driverName','externalDriverId']};
const specs={drivers:{key:'rosterDrivers',name:'司機名冊',fields:fields.drivers,editStart:10,sequence:19,version:20,status:21,time:22,width:26,headers:['紀錄ID','目前司機ID','目前姓名','目前電話','目前車型','目前駕照類型','目前證照到期日','目前倉別','目前來源狀態','目前員工編號','變更司機ID','變更姓名','變更電話','變更車型','變更駕照類型','變更證照到期日','變更倉別','變更來源狀態','變更員工編號','提交序號','讀取版本','處理狀態','最後同步時間','提醒起日','剩餘天數','證照提醒']},vehicles:{key:'rosterVehicles',name:'車輛名冊',fields:fields.vehicles,editStart:5,sequence:9,version:10,status:11,time:12,width:13,headers:['紀錄ID','目前車牌','目前車型','目前參考司機姓名','目前參考司機ID','變更車牌','變更車型','變更參考司機姓名','變更參考司機ID','提交序號','讀取版本','處理狀態','最後同步時間']}};
const uid=(kind,r)=>r.rosterUid||hash([SOURCE_ID,kind,r.sourceRow,r.key]).slice(0,32);
const values=(kind,r)=>Object.fromEntries(fields[kind].map(k=>[k,String(r[k]??'')]));
const version=(kind,r)=>hash(values(kind,r));
module.exports={specs,uid,values,version};
