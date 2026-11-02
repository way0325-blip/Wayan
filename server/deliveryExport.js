const {isValidDateKey}=require('./dates');
function cell(value){let text=String(value??'');if(/^\s*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function register(router,pool,logAction){router.get('/orders/export/csv',async(req,res,next)=>{try{
 const {from,to}=req.query;
 if(!isValidDateKey(from)||!isValidDateKey(to)||to<from||Date.parse(to)-Date.parse(from)>30*86400000)return res.status(400).json({error:'請選擇有效起迄日期，最多31天'});
 const {rows}=await pool.query(`SELECT o.reference,w.name warehouse_name,s.code store_code,o.service_date,o.quantity,o.note,s.name store_name,s.city,s.district,s.address,o.status,t.task_code,t.task_name,f.name fleet_name,d.name driver_name,v.plate,o.route_code,p.name pickup_point_name,p.box_type FROM delivery_orders o JOIN delivery_warehouses w ON w.id=o.warehouse_id JOIN delivery_stores s ON s.id=o.store_id LEFT JOIN delivery_pickup_points p ON p.id=o.pickup_point_id LEFT JOIN delivery_trip_stops st ON st.order_id=o.id AND st.released_at IS NULL LEFT JOIN delivery_trips t ON t.id=st.trip_id LEFT JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE o.service_date BETWEEN $1 AND $2 ORDER BY o.service_date,o.id LIMIT 10001`,[from,to]);
 if(rows.length>10000)return res.status(422).json({error:'超過10000筆，請縮小日期範圍後下載'});
 const keys=['reference','warehouse_name','store_code','service_date','quantity','note','store_name','city','district','address','status','task_code','task_name','fleet_name','driver_name','plate','route_code','pickup_point_name','box_type','service_type'];
 const header=['訂單編號','取貨倉','門店代碼','作業日期','件數','備註','門店名稱','縣市','行政區','地址','訂單狀態','車趟編號','車趟名稱','夥伴車隊','自有司機','車牌','路線代碼','取貨點','箱型','配送類型'];
 await logAction(req,'匯出訂單','蝦皮門店訂單','',`${from}～${to}／${rows.length}筆`);
 res.set({'Cache-Control':'no-store','Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="shopee-orders-${from}-${to}.csv"`}).send('\ufeff'+[header,...rows.map(row=>keys.map(k=>k==='service_type'?(require('../public/deliveryRouting').classify(row.route_code)?.serviceType||''):row[k]))].map(row=>row.map(cell).join(',')).join('\r\n'));
 }catch(e){next(e);}});}
module.exports={register,cell};
