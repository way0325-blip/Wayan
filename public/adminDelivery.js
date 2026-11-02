(() => {
 const el=id=>document.getElementById(id),day=WayanServiceDay.taipeiDay();
 el('adminDeliveryExportFrom').value=day;el('adminDeliveryExportTo').value=day;
 function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 el('adminDeliveryTemplate').addEventListener('click',()=>download(new Blob(['\ufeff訂單編號,取貨倉,門店代碼,作業日期,件數,備註,路線代碼,取貨點\r\n'],{type:'text/csv;charset=utf-8'}),'蝦皮店到店-訂單匯入範本.csv'));
 document.addEventListener('wayan:delivery-import',event=>{if(event.detail.kind==='orders')el('adminDeliveryImportResult').textContent='已成功匯入 '+event.detail.count+' 筆蝦皮店到店訂單';});
 el('adminDeliveryImport').addEventListener('click',()=>el('deliveryImportOrders').click());
 el('adminDeliveryExportForm').addEventListener('submit',async event=>{event.preventDefault();const button=el('adminDeliveryExport'),message=el('adminDeliveryExportResult'),from=el('adminDeliveryExportFrom').value,to=el('adminDeliveryExportTo').value;message.textContent='';if(!from||!to||to<from||Date.parse(to)-Date.parse(from)>30*86400000){message.textContent='請選擇有效起迄日期，最多31天';return;}button.disabled=true;try{const response=await fetch('/api/store-delivery/orders/export/csv?'+new URLSearchParams({from,to}),{headers:{Authorization:'Bearer '+getToken()}});if(!response.ok){const data=await response.json();throw Error(data.error||'下載失敗');}download(await response.blob(),`蝦皮店到店-訂單-${from}-${to}.csv`);message.textContent=`已下載 ${from}～${to} 的蝦皮店到店訂單`;}catch(error){message.textContent=error.message;}finally{button.disabled=false;}});
})();
