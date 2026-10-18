/** Plain browser JS, deliberately not Function.toString(): tsx/other bundlers
 * may inject closure helpers (for example keepNames/__name) into functions. */
const runtime=String.raw`(function(config){
  const scope=window,allowed=new Set(config.datasetIds);
  let pending=false;
  scope.lenLive=Object.freeze({refresh:async function(id){
    if(!allowed.has(id)||parent===window)throw Error('live_dataset_not_found');
    if(pending)throw Error('data_refresh_busy');
    pending=true;
    try{
      const result=await new Promise(function(resolve,reject){
        const channel=new MessageChannel();
        const timer=setTimeout(function(){channel.port1.close();reject(Error('data_refresh_timeout'));},20000);
        channel.port1.onmessage=function(event){
          clearTimeout(timer);channel.port1.close();
          const data=event.data;
          if(!data||data.ok!==true||data.dataset?.id!==id||!Number.isSafeInteger(data.revision)){reject(Error(typeof data?.code==='string'?data.code:'data_refresh_failed'));return;}
          resolve({dataset:data.dataset,revision:data.revision});
        };
        try{parent.postMessage({kind:'openlen.artifact.live.request',channel:config.channel,requestId:crypto.randomUUID(),datasetId:id},config.appOrigin,[channel.port2]);}
        catch{clearTimeout(timer);channel.port1.close();channel.port2.close();reject(Error('data_refresh_failed'));}
      });
      const datasets=(scope.lenData?.datasets??[]).map(function(dataset){return dataset.id===id?result.dataset:dataset;});
      scope.lenData=Object.freeze({datasets:datasets});
      const badge=document.getElementById('len-data-provenance');
      if(badge)badge.textContent=datasets.map(function(d){return d.mode==='scenario'?'Escenario hipotético':'Datos '+(d.mode==='live'?'actualizados':'capturados')+' · '+(d.environment??d.source)+' · '+d.capturedAt+(d.truncated?' · Datos recortados':'');}).join(' | ');
      dispatchEvent(new CustomEvent('len:data',{detail:result}));
      return result;
    }finally{pending=false;}
  }});
})`;
export function livePreviewScript(config:{appOrigin:string;channel:string;datasetIds:string[]}){
  return `${runtime}(${JSON.stringify(config).replace(/</g,"\\u003c")});`.replace(/<\/script/gi,"<\\/script");
}
