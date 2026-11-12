/* Historical NWS Flash Flood Warnings (Iowa Environmental Mesonet).
 * One range request per selected event; all playback filtering happens locally.
 * Data are independent of the archived MRMS rainfall/CREST calculations.
 */
(function(global){
 'use strict';

 const DATE_FIELDS={
  begin:['polygon_begin','poly_beg','polygon_start','issue','issued','init_iss','start','start_time','valid_from'],
  end:['polygon_end','poly_end','polygon_expire','expire','expired','end','end_time','valid_to']
 };

 function parseUtc(value){
  if(value==null||value==='')return NaN;
  if(typeof value==='number')return value>1e12?value:value>1e9?value*1000:NaN;
  const s=String(value).trim();
  // IEM shapefile timestamps use YYYYMMDDHHmm (always UTC).
  if(/^\d{12}$/.test(s))return Date.parse(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':00Z');
  if(/^\d{14}$/.test(s))return Date.parse(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12,14)+'Z');
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s))return Date.parse(s.replace(' ','T')+(s.endsWith('Z')||/[+-]\d\d:?\d\d$/.test(s)?'':'Z'));
  return Date.parse(s);
 }
 function firstTime(props,keys){
  for(const key of keys){
   const value=props[key]??props[key.toUpperCase()];
   const time=parseUtc(value);
   if(Number.isFinite(time))return time;
  }
  return NaN;
 }
 function isFlashFloodWarning(feature){
  if(!feature||!feature.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))return false;
  const p=feature.properties||{};
  const ps=String(p.ps||p.PS||'').toUpperCase();
  const phenom=String(p.phenomena||p.phenom||p.phen||p.PHENOM||'').toUpperCase();
  const sig=String(p.significance||p.sig||p.SIG||'').toUpperCase();
  return ps==='FF.W'||ps==='FFW'||(phenom==='FF'&&sig==='W');
 }
 function asTimedPolygon(feature){
  if(!isFlashFloodWarning(feature))return null;
  const p=feature.properties||{};
  const begin=firstTime(p,DATE_FIELDS.begin),end=firstTime(p,DATE_FIELDS.end);
  if(!Number.isFinite(begin)||!Number.isFinite(end)||end<=begin)return null;
  return {feature,begin,end};
 }
 function createFlashFloodWarnings({map,L,toggle,status}){
  map.createPane('flashFloodWarnings');
  map.getPane('flashFloodWarnings').style.zIndex='460';
  const layer=L.geoJSON(null,{
   pane:'flashFloodWarnings',
   style:()=>({color:'#39ff63',weight:3,opacity:1,fillColor:'#33ed62',fillOpacity:0.075}),
   onEachFeature:(feature,polygon)=>{
    const p=feature.properties||{},container=document.createElement('div');
    const heading=document.createElement('strong');heading.textContent='Flash Flood Warning';container.append(heading);
    const items=[
     ['WFO',p.wfo||p.WFO||p.office],
     ['Event',p.etn||p.ETN||p.eventid],
     ['Valid from',p.polygon_begin||p.poly_beg||p.issue||p.issued],
     ['Valid until',p.polygon_end||p.poly_end||p.expire||p.expired]
    ];
    for(const [label,value] of items){
     if(value==null||value==='')continue;
     const line=document.createElement('div');line.textContent=label+': '+value;container.append(line);
    }
    polygon.bindPopup(container);
   }
  }).addTo(map);
  let currentEvent=null,eventVersion=0,controller=null,selectedTime=null,records=null,problem=null;
  let lastDisplayedTime=null;

  function setStatus(message){status.textContent=message}
  function render(){
   if(!toggle.checked){layer.clearLayers();setStatus('Off');return}
   if(!currentEvent||!Number.isFinite(selectedTime)){layer.clearLayers();setStatus('Waiting for archive time');return}
   if(problem){layer.clearLayers();setStatus(problem);return}
   if(records===null){layer.clearLayers();setStatus('Loading event warning history…');return}
   if(lastDisplayedTime===selectedTime)return;
   layer.clearLayers();
   const active=records.filter(item=>item.begin<=selectedTime&&selectedTime<item.end);
   if(active.length)layer.addData({type:'FeatureCollection',features:active.map(item=>item.feature)});
   lastDisplayedTime=selectedTime;
   setStatus(active.length?active.length+' active Flash Flood Warning'+(active.length===1?'':'s'):'No active Flash Flood Warnings');
  }
  function setTime(utc){
   const parsed=parseUtc(utc);
   selectedTime=Number.isFinite(parsed)?parsed:null;
   render();
  }
  function reset(event){
   ++eventVersion;
   if(controller){controller.abort();controller=null}
   currentEvent=event||null;records=null;problem=null;lastDisplayedTime=null;
   selectedTime=null;layer.clearLayers();
   render();
   if(!event)return;
   const start=parseUtc(event.start_utc),end=parseUtc(event.end_utc);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){
    problem='Warning event window unavailable';render();return;
   }
   const url=new URL('https://mesonet.agron.iastate.edu/geojson/sbw.geojson');
   url.searchParams.set('sts',new Date(start).toISOString());
   url.searchParams.set('ets',new Date(end).toISOString());
   url.searchParams.set('states','LA,MS');
   const requestVersion=eventVersion,abort=new AbortController();
   controller=abort;
   fetch(url.toString(),{signal:abort.signal}).then(async response=>{
    if(!response.ok)throw Error('IEM HTTP '+response.status);
    const geo=await response.json();
    if(!geo||!Array.isArray(geo.features))throw Error('Invalid IEM GeoJSON');
    if(requestVersion!==eventVersion)return;
    const matches=geo.features.filter(isFlashFloodWarning);
    const parsed=matches.map(asTimedPolygon).filter(Boolean);
    // Never present a false 'no warnings' when archived features lack timing metadata.
    if(matches.length&&parsed.length!==matches.length){
     throw Error('Unrecognized or missing IEM polygon validity times');
    }
    records=parsed;
    lastDisplayedTime=null;
    render();
   }).catch(error=>{
    if(requestVersion!==eventVersion||error.name==='AbortError')return;
    problem='Archived warnings unavailable';
    console.warn('IEM Flash Flood Warning event download failed',error);
    render();
   }).finally(()=>{if(controller===abort)controller=null});
  }
  toggle.addEventListener('change',()=>{lastDisplayedTime=null;render()});
  return {reset,setTime,layer};
 }
 global.createFlashFloodWarnings=createFlashFloodWarnings;
 global.__flashFloodWarningInternals={parseUtc,asTimedPolygon,isFlashFloodWarning};
})(window);
