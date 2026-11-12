/* Historical NWS Flash Flood Warning polygons, independent of MRMS data.
 * Source: Iowa Environmental Mesonet (IEM) archive, queried for exact UTC time.
 * Archived warning snapshots are unofficial and may be incomplete.
 */
(function(global){
 'use strict';
 function createFlashFloodWarnings({map,L,toggle,status}){
  map.createPane('flashFloodWarnings');
  const pane=map.getPane('flashFloodWarnings');
  pane.style.zIndex='460';
  const layer=L.geoJSON(null,{
   pane:'flashFloodWarnings',
   style:()=>({color:'#39ff63',weight:3,opacity:1,fillColor:'#33ed62',fillOpacity:0.075}),
   onEachFeature:(feature,polygon)=>{
    const p=feature.properties||{};
    const container=document.createElement('div');
    const title=document.createElement('strong');
    title.textContent='Flash Flood Warning';
    container.append(title);
    const details=[
     p.wfo||p.office?('WFO: '+(p.wfo||p.office)):null,
     p.etn||p.eventid?('Event: '+(p.etn||p.eventid)):null,
     p.issue||p.issued?('Issued: '+(p.issue||p.issued)):null,
     p.expire||p.expired?('Expires: '+(p.expire||p.expired)):null
    ].filter(Boolean);
    details.forEach(item=>{const line=document.createElement('div');line.textContent=item;container.append(line)});
    polygon.bindPopup(container);
   }
  }).addTo(map);
  let currentEvent=null,version=0,timer=null,controller=null;
  const cache=new Map();
  function clearPending(){
   if(timer!==null){clearTimeout(timer);timer=null}
   if(controller){controller.abort();controller=null}
  }
  function setStatus(message){status.textContent=message}
  function reset(event){
   ++version;clearPending();layer.clearLayers();cache.clear();currentEvent=event||null;
   setStatus(toggle.checked?'Waiting for archive time':'Off');
  }
  function validWarning(feature){
   if(!feature||!feature.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))return false;
   const p=feature.properties||{};
   const ps=String(p.ps||'').toUpperCase();
   const phenom=String(p.phenomena||p.phenom||p.phen||'').toUpperCase();
   const sig=String(p.significance||p.sig||'').toUpperCase();
   return ps==='FF.W'||ps==='FFW'||(phenom==='FF'&&(sig==='W'||!sig));
  }
  function draw(features,utc){
   layer.clearLayers();
   if(!toggle.checked)return;
   const valid=features.filter(validWarning);
   if(valid.length)layer.addData({type:'FeatureCollection',features:valid});
   setStatus(valid.length?valid.length+' active at '+new Date(utc).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'No active Flash Flood Warnings');
  }
  async function fetchWarnings(utc,requestVersion){
   const abort=new AbortController();controller=abort;
   try{
    const url=new URL('https://mesonet.agron.iastate.edu/geojson/sbw.geojson');
    url.searchParams.set('ts',utc);
    url.searchParams.set('states','LA,MS');
    const response=await fetch(url.toString(),{signal:abort.signal});
    if(!response.ok)throw Error('IEM HTTP '+response.status);
    const geo=await response.json();
    if(!geo||!Array.isArray(geo.features))throw Error('Invalid IEM GeoJSON');
    if(requestVersion!==version||!toggle.checked)return;
    cache.set(utc,geo.features);
    if(cache.size>300)cache.delete(cache.keys().next().value);
    draw(geo.features,utc);
   }catch(error){
    if(requestVersion!==version||error.name==='AbortError')return;
    layer.clearLayers();
    setStatus('Archived warnings unavailable');
    console.warn('IEM Flash Flood Warning lookup failed',error);
   }finally{if(controller===abort)controller=null}
  }
  function setTime(utc){
   ++version;clearPending();layer.clearLayers();
   if(!toggle.checked){setStatus('Off');return}
   if(!currentEvent||!utc||!Number.isFinite(Date.parse(utc))){setStatus('Waiting for archive time');return}
   if(cache.has(utc)){draw(cache.get(utc),utc);return}
   setStatus('Loading historical warnings…');
   const requestVersion=version;
   timer=setTimeout(()=>{timer=null;fetchWarnings(utc,requestVersion)},90);
  }
  toggle.addEventListener('change',()=>{
   if(!toggle.checked){++version;clearPending();layer.clearLayers();setStatus('Off')}
   else setTime(global.__flashFloodArchiveTime?.()||null);
  });
  return {reset,setTime,layer};
 }
 global.createFlashFloodWarnings=createFlashFloodWarnings;
})(window);
