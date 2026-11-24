(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WayanRouteGroups=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const labels={NB:'店配',FN:'隔日到貨',WB:'黑箱隔日到貨'};
 function timeWindow(value){
  const raw=String(value??'').trim(),normalized=raw.replace(/[：]/g,':').replace(/[～~－–—至]/g,'-').replace(/\s/g,'');
  const match=/^(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?$/.exec(normalized);
  if(!match||Number(match[1])>23||Number(match[2])>59||(match[3]!==undefined&&(Number(match[3])>23||Number(match[4])>59)))return {raw,key:'pending',label:'時段待核對',type:'待核對',start:'',end:'',overnight:false,sort:Infinity};
  const start=match[1].padStart(2,'0')+':'+match[2],end=match[3]===undefined?'':match[3].padStart(2,'0')+':'+match[4];
  return {raw,key:start+(end?'-'+end:''),label:start+(end?'-'+end:''),type:end?'時段區間':'單一時點',start,end,overnight:!!end&&end<start,sort:Number(match[1])*60+Number(match[2])};
 }
 function region(stop){
  if(stop.city&&stop.district)return {city:String(stop.city).replace(/^台/,'臺'),district:String(stop.district)};
  const address=String(stop.address??'').trim(),match=/^(?:\d{3,6}\s*)?([\u4e00-\u9fff]{2,3}[縣市])(新市區|[\u4e00-\u9fff]{1,4}?[鄉鎮市區])/.exec(address);
  if(match)return {city:match[1].replace(/^台/,'臺'),district:match[2]};
  return {city:String(stop.city||'').replace(/^台/,'臺'),district:String(stop.district||'')};
 }
 function areas(route){const cities=[],districts=[];let unresolved=0;for(const stop of route.stops||[]){const r=region(stop);if(r.city&&!cities.includes(r.city))cities.push(r.city);if(r.city&&r.district){const key=r.city+r.district;if(!districts.includes(key))districts.push(key);}else unresolved++;}return {cities,districts,unresolved};}
 function groups(routes){const map=new Map();for(const route of routes){const window=timeWindow(route.timeWindow);if(!map.has(window.key))map.set(window.key,{...window,count:0});map.get(window.key).count++;}return [...map.values()].sort((a,b)=>a.sort-b.sort||a.key.localeCompare(b.key));}
 function matches(route,window){return !window||timeWindow(route.timeWindow).key===window;}
 return {labels,timeWindow,region,areas,groups,matches};
});
