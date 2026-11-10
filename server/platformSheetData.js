const {hash,SOURCE_ID}=require('./sourceCatalog');
const MAX_ROWS=20000,MAX_CELLS=1500000;
const view=(name,table,spec,where='')=>({name:'平台_'+name,table,columns:spec.split('|').map(x=>x.split(':')),where});
const views=[
 view('自有司機','drivers','id:司機編號|name:姓名|phone:電話|license:證照|status:狀態|roster_driver_id:雲端司機ID'),
 view('自有車輛','vehicles','id:車輛編號|plate:車牌|type:車型|maintenance:保養|inspection_date:驗車日|status:狀態'),
 view('車輛保養','vehicle_maintenance_items','id:紀錄ID|vehicle_id:車輛ID|item_name:保養項目|due_date:期限|note:備註|created_at:建立時間'),
 view('調度人員','dispatch_staff','id:人員ID|name:姓名|phone:電話|active:啟用'),
 view('出勤記錄','attendance_records','id:紀錄ID|staff_type:人員類別|staff_id:人員ID|date:日期|status:出勤狀態|note:備註|updated_by:更新人|updated_at:更新時間'),
 view('港口歷史訂單','orders','id:訂單ID|ship:船名航次|container:櫃號|from_location:起點|to_location:終點|time:時間|size:櫃型|status:狀態|driver_id:司機ID|vehicle_id:車輛ID|dispatch_type:派遣類型|carrier:船公司|ship_call:船掛'),
 view('路線需求','shopee_routes','id:需求ID|service_date:作業日期|origin:起點|destination:終點|vehicle_type:車型|required_trucks:需求車數|demand_category:需求分類|note:備註|created_at:建立時間'),
 view('車隊承接','shopee_assignments','id:承接ID|route_id:需求ID|fleet_id:車隊ID|requested_trucks:要求車數|confirmed_trucks:確認車數|status:狀態|updated_at:更新時間'),
 view('車隊名冊','partner_fleets','id:車隊ID|name:車隊名稱|contact_name:聯絡人|phone:電話|daily_capacity:每日容量|status:狀態|note:備註'),
 view('車隊承接能力','fleet_routes','id:紀錄ID|fleet_id:車隊ID|origin:起點|destination:終點|vehicle_type:車型|max_trucks:最大車數|active:啟用'),
 view('LINE群組','line_group_registry','group_id:群組ID|label:名稱|bot_present:Bot在場|last_seen_at:最近事件|last_event_type:事件類型|created_at:登記時間'),
 view('群組綁定','line_fleet_groups','group_id:群組ID|fleet_id:車隊ID|bound_by:綁定人|bound_at:綁定時間'),
 view('任務通知','fleet_work_orders','id:任務ID|fleet_id:車隊ID|title:任務名稱|service_date:日期|origin:起點|destination:終點|vehicle_type:車型|requested_trucks:需求車數|confirmed_trucks:確認車數|status:狀態|note:備註|updated_at:更新時間'),
 view('異常案件','fleet_incidents','id:案件ID|task_id:車隊任務ID|delivery_trip_id:車趟ID|fleet_id:車隊ID|kind:類型|severity:嚴重程度|status:狀態|description:內容|handler:處理人|resolution:處理結果|created_at:回報時間|updated_at:更新時間'),
 view('異常處理歷程','fleet_incident_history','id:紀錄ID|incident_id:案件ID|actor:操作人|action:操作|previous_status:原狀態|next_status:新狀態|note:說明|created_at:時間'),
 view('車輛事故回報','operational_incidents','id:案件ID|order_id:訂單ID|driver_id:司機ID|vehicle_id:車輛ID|kind:類型|detail:內容|status:狀態|resolution:處理結果|created_at:建立時間|resolved_at:結案時間'),
 view('罰款規則版本','penalty_rules','id:規則ID|rule_code:規則代碼|version:版本|title:名稱|terms:條款|source:條款來源|points:參考點數|proposed_amount:參考金額|effective_date:生效日|status:狀態|verified_by:覆核人|verified_at:覆核時間'),
 view('規則覆核歷程','penalty_rule_history','id:紀錄ID|rule_id:規則ID|actor:操作人|action:操作|note:說明|created_at:時間'),
 view('違規罰款案件','penalty_cases','id:案件ID|fleet_id:車隊ID|rule_id:規則ID|incident_id:異常ID|occurred_on:發生日|status:狀態|points:人工確認點數|amount:人工確認金額|responsibility:責任說明|appeal:申訴|reviewer:覆核人|decision:結論|updated_at:更新時間'),
 view('罰款處理歷程','penalty_case_history','id:紀錄ID|case_id:案件ID|actor:操作人|action:操作|note:說明|created_at:時間'),
 view('車隊總數報到','shopee_fleet_reports','id:紀錄ID|fleet_id:車隊ID|service_date:日期|reported_total:回報總車數|source:來源|note:備註|created_at:回報時間'),
 view('LINE關鍵字','line_keyword_replies','keyword:關鍵字|reply:回覆內容|enabled:啟用|updated_by:更新人|updated_at:更新時間'),
 view('LINE動態','fleet_line_activity','event_id:事件ID|fleet_id:車隊ID|group_id:群組ID|event_type:事件類型|message_type:訊息類型|content:內容|sender_label:顯示名稱|received_at:接收時間','NOT t.hidden'),
 view('門店名冊','delivery_stores','id:門店ID|code:門店代碼|name:名稱|city:縣市|district:行政區|address:地址|source:來源|verified:核對|active:啟用|updated_at:更新時間'),
 view('倉別','delivery_warehouses','id:倉別ID|name:名稱|address:區域地址|updated_at:更新時間'),
 view('取貨點','delivery_pickup_points','id:取貨點ID|warehouse_id:倉別ID|name:名稱|box_type:箱型|address:正式地址'),
 view('配送訂單','delivery_orders','id:訂單ID|reference:訂單編號|warehouse_id:倉別ID|pickup_point_id:取貨點ID|store_id:門店ID|service_date:日期|route_code:路線編號|quantity:件數|status:狀態|note:備註|created_at:建立時間'),
 view('派車任務','delivery_trips','id:車趟ID|service_date:日期|task_code:任務編號|task_name:任務名稱|warehouse_id:倉別ID|pickup_point_name:取貨點|departure_time:出發時間|fleet_id:實派車隊ID|driver_id:司機ID|vehicle_id:車輛ID|status:狀態|required_checkins:需求報到|source_fleet_name:建趟來源車行|updated_at:更新時間'),
 view('車趟停靠','delivery_trip_stops','id:紀錄ID|trip_id:車趟ID|order_id:訂單ID|stop_no:站序|route_code:路線編號|store_code:門店代碼|store_name:名稱|city:縣市|district:行政區|address:地址|released_at:移除時間|delivered_at:送達時間',"EXISTS(SELECT 1 FROM delivery_trips p WHERE p.id=t.trip_id AND NOT p.is_simulated AND p.note NOT LIKE '[模擬]%')"),
 view('司機接取報到','delivery_route_claims','id:接取ID|trip_id:車趟ID|driver_code:司機ID|driver_name:姓名|route_code:路線編號|service_date:日期|fleet_name:車隊|departure_time:出車時間|stop_count:停靠數|accepted_at:接取時間|checked_in_at:報到時間|revoked_at:退回時間|revoke_reason:退回原因|updated_at:更新時間'),
 view('報到紀錄','delivery_checkins','id:紀錄ID|trip_id:車趟ID|driver_id:司機ID|claim_id:接取ID|created_at:報到時間'),
 view('退趟改報','delivery_trip_returns','id:紀錄ID|trip_id:原車趟ID|target_trip_id:目標車趟ID|driver_code:司機ID|route_code:路線編號|fleet_id:車隊ID|kind:類型|status:狀態|reason:原因|requested_at:申請時間|processed_at:處理時間|reviewed_by:處理人'),
 view('使用者角色','users','id:使用者ID|username:帳號|role:角色|active:啟用'),
 view('操作稽核','audit_logs','id:紀錄ID|at:時間|username:操作人|role:角色|action:操作|entity:資料類型|entity_id:資料ID'),
 view('同步傳送狀態','fleet_delivery_jobs','id:工作ID|kind:類型|status:狀態|attempts:次數|error_code:錯誤碼|created_at:建立時間|updated_at:更新時間',"COALESCE(t.payload->>'key','')<>'platformSnapshot'"),
 view('網站設定','settings','key:設定|value:內容',"t.key IN ('system_name','announcement','locations','container_sizes','carriers','shopee_vehicle_types')"),
 view('車行名冊對應','dispatch_source_fleet_aliases','source_name:來源車行|fleet_id:平台車隊ID|updated_by:設定人|updated_at:更新時間')
];
function cell(v){if(v==null)return '';if(v instanceof Date)return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(v);if(typeof v==='boolean'||typeof v==='number')return v;const s=typeof v==='string'?v:JSON.stringify(v);if(s.length>45000)throw Object.assign(new Error('PLATFORM_CELL_TOO_LONG'),{code:'PLATFORM_CELL_TOO_LONG'});return s;}
const dataset=(name,headers,rows)=>({name,headers,rows:rows.map(r=>r.map(cell))});
async function collect(db){const result=[];for(const v of views){const fields=v.columns.map(([k])=>'t."'+k+'"').join(','),where=["COALESCE(to_jsonb(t)->>'is_simulated','false')<>'true'","COALESCE(to_jsonb(t)->>'note','') NOT LIKE '[模擬]%'",v.where].filter(Boolean).join(' AND '),order=v.columns[0][0];const rows=(await db.query(`SELECT ${fields} FROM ${v.table} t WHERE ${where} ORDER BY t."${order}" LIMIT ${MAX_ROWS+1}`)).rows;result.push(dataset(v.name,v.columns.map(([,h])=>h),rows.map(r=>v.columns.map(([k])=>r[k]))));}
 const batches=(await db.query('SELECT DISTINCT ON(kind) id,kind,records,created_at FROM source_catalog_batches WHERE source_id=$1 ORDER BY kind,id DESC',[SOURCE_ID])).rows,routeRows=[],stops=[],rosters={drivers:[],vehicles:[],parking:[],cars:[]};for(const b of batches){if(['NB','FN','WB'].includes(b.kind)){const projected=await require('./routeCarriers').attach(db,require('./sourceCatalog').projectRegions(b));for(const r of projected.records){routeRows.push([b.kind,r.routeCode,r.region,r.sourceFleetName,r.vehicleType,r.boxType,r.timeWindow,r.dock,r.stops.length,r.problems.join('；'),b.id,r.sourceRow]);for(const s of r.stops)stops.push([b.kind,r.routeCode,s.sequence,s.name,s.address,s.city,s.district,b.id,s.sourceRow]);}}else if(rosters[b.kind])for(const r of b.records)rosters[b.kind].push(r);}
 for(const category of Object.keys(require('./pickupRoutes').names)){const b=await require('./pickupRoutes').list(db,category);for(const r of b.records){routeRows.push([category,r.routeCode,r.region,r.sourceFleetName||r.fleet||'',r.vehicleType,'',r.timeWindow||'',r.dock||'',r.stops.length,r.problems.join('；'),b.batchId,r.sourceRow]);for(const s of r.stops)stops.push([category,r.routeCode,s.sequence,s.name,s.address,s.city||'',s.district||'',b.batchId,s.sourceRow]);}}
 result.push(dataset('平台_路線清單',['類別','路線編號','地區','來源車行','車型','箱型','出車時段','碼頭','停靠點數','待核對','來源版本','來源列'],routeRows),dataset('平台_路線站點',['類別','路線編號','站序','名稱','地址','縣市','行政區','來源版本','來源列'],stops));
 const rosterFields={drivers:['externalDriverId','name','phone','vehicleType','licenseType','license','warehouse','sourceStatus'],vehicles:['plate','vehicleType','driverName','externalDriverId'],parking:['plate','vehicleType','supplier','use','externalDriverId'],cars:['plate','vehicleType','phone','registeredOn','submitted']},rosterNames={drivers:'雲端司機名冊',vehicles:'雲端車輛名冊',parking:'園區停車場名冊',cars:'汽車造冊'},rosterLabels={drivers:['司機ID','姓名','電話','車型','證照類型','證照期限','倉別','狀態'],vehicles:['車牌','車型','參考司機','參考司機ID'],parking:['車牌','車型','車行','用途','車主司機ID'],cars:['車牌','車型','電話','登錄日期','提交狀態']};for(const kind of Object.keys(rosters))result.push(dataset('平台_'+rosterNames[kind],rosterLabels[kind],rosters[kind].map(r=>rosterFields[kind].map(k=>r[k]))));
 const mapping=await require('./carrierMappings').catalog(db);result.push(dataset('平台_車行路線對照',['路線編號','地區','來源車行','問題','來源版本'],mapping.records.map(r=>[r.routeCode,require('../public/routeRegions').classify(r.routeCode).region,r.fleetName,r.problems.join('；'),mapping.mappingId])));
 const trips=result.find(r=>r.name==='平台_派車任務'),projected=await require('./routeCarriers').attachTrips(db,trips.rows.map(r=>({id:r[0],source_fleet_name:r[12]})));trips.headers.push('目前核對來源車行','車行核對狀態','車行對照版本');trips.rows.forEach((r,i)=>r.push(projected[i].source_fleet_name,projected[i].source_carrier_status,cell(projected[i].source_carrier_mapping_id)));
 for(const v of result)if(v.rows.length>MAX_ROWS)throw Object.assign(new Error('PLATFORM_ROW_LIMIT'),{code:'PLATFORM_ROW_LIMIT'});if(result.reduce((n,v)=>n+(v.rows.length+1)*v.headers.length,0)>MAX_CELLS)throw Object.assign(new Error('PLATFORM_CELL_LIMIT'),{code:'PLATFORM_CELL_LIMIT'});return {datasets:result,digest:hash(result)};
}
const tables=new Set([...views.map(v=>v.table),'source_catalog_batches','pickup_route_batches','dispatch_source_batches','line_driver_bindings']);tables.delete('fleet_delivery_jobs');tables.delete('settings');
module.exports={collect,views,cell,tables,MAX_ROWS};
