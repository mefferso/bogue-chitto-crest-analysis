const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=process.cwd();
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let failAssets=false;let basinRequests=0;const basinAssetPaths=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='basins.test'){
   const name=decodeURIComponent(url.pathname.slice(1))||'index.html';
   if(name==='data/events.json'){
    const index=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
    index.events.push({id:'test-rain-only',name:'Rainfall only test',label:'Rainfall only test',start_utc:'2026-10-31T19:00:00Z',end_utc:'2026-11-01T08:00:00Z',data_dir:'data/events/2026-10-31_jefferson-parish-la',products:{rainfall:true,crest:false}});
    index.events.push({id:'test-no-rain',name:'No rainfall test',label:'No rainfall test',data_dir:'data/no-such-event',products:{rainfall:true,crest:false}});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(index)});
   }
   if(name.startsWith('data/basins/')){basinRequests++;basinAssetPaths.push(name);if(failAssets)return route.fulfill({status:503,body:'Offline test'});}
   const file=path.join(root,name);
   if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
   return route.fulfill({path:file,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/json'});
  }
  if(url.pathname.endsWith('leaflet.js'))return route.fulfill({path:path.join(root,'work/leaflet.js'),contentType:'text/javascript'});
  if(url.pathname.endsWith('leaflet.css'))return route.fulfill({path:path.join(root,'work/leaflet.css'),contentType:'text/css'});
  return route.abort();
 });
 await page.goto('http://basins.test/?event=2026-10-31_pearl-river-ms');
 await page.waitForFunction(()=>rainData&&data&&document.querySelector('#status').textContent.includes('rainfall'));
 async function dragRectangle(points){
  await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress);
  const pixels=await page.evaluate(values=>{const rect=$('map').getBoundingClientRect();return values.map(([lat,lng])=>{const p=map.latLngToContainerPoint([lat,lng]);return{x:rect.left+p.x,y:rect.top+p.y}})},points);
  await page.mouse.move(pixels[0].x,pixels[0].y);await page.mouse.down();await page.mouse.move(pixels[1].x,pixels[1].y,{steps:4});await page.mouse.up();
 }
 async function dragRectangleInMap(x1,y1,x2,y2){
  await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress);
  const rect=await page.locator('#map').boundingBox();await page.mouse.move(rect.x+x1,rect.y+y1);await page.mouse.down();await page.mouse.move(rect.x+x2,rect.y+y2,{steps:4});await page.mouse.up();
 }
 async function applyArea(){await page.click('#applyAreaDrawing')}
 assert.equal(await page.textContent('#analysisAreaSummary'),'Entire Event · archived MRMS grid coverage');
 assert.equal(await page.locator('#rainEvent').textContent(),await page.evaluate(()=>fmt(rainData.summary.max_event_inches)+' in'));
 // Draw a rectangle around exactly one known rainfall grid-cell center.
 const reference=await page.evaluate(()=>{
  let r=0,c=0;outer:for(let y=0;y<rainData.latitudes.length;y++)for(let x=0;x<rainData.longitudes.length;x++)if(rainData.frames.cumulative.at(-1)?.[y]?.[x]!=null){r=y;c=x;break outer}
  const lat=rainData.latitudes[r],lon=rainData.longitudes[c],dh=rainData.dlat*.2,dw=rainData.dlon*.2;
  return {r,c,lat,lon,points:[[lat-dh,lon-dw],[lat+dh,lon+dw]],values:rainData.frames.cumulative.map(frame=>frame?.[r]?.[c]).filter(v=>v!=null),one:rainData.frames.one_hour.map(frame=>frame?.[r]?.[c]).filter(v=>v!=null)}
 });
 await page.selectOption('#analysisAreaMode','rectangle');
 await dragRectangle(reference.points);await applyArea();
 await page.waitForFunction(()=>analysisAreaName==='Drawn rectangle');
 const rectangleStats=await page.evaluate(()=>({cells:rainSelection.cells.length,max:rainAnalysis.maxEvent?.value,mean:rainAnalysis.meanEvent}));
 assert.ok(rectangleStats.cells>0,'dragged rectangle selects archived rainfall cells');
 const format=value=>value==null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
 assert.equal(await page.textContent('#rainEvent'),format(rectangleStats.max)+' in','rectangle summary follows its selected cells');
 assert.equal(await page.textContent('#rainMeanEvent'),format(rectangleStats.mean)+' in','rectangle mean follows its selected cells');
 assert.equal(await page.locator('#resetAnalysisArea').isVisible(),true);
 await page.selectOption('#rainChartStatistic','mean');assert.match(await page.textContent('#chartReadout'),/Event:/);
 await page.selectOption('#product','crest');await page.check('#showCrest');assert.equal(await page.evaluate(()=>analysisGeometry!==null),true);
 assert.ok(await page.locator('#rainChart path[stroke="#a0e28b"]').count()>0);
 await page.selectOption('#product','rainfall');await page.selectOption('#analysisAreaMode','polygon');
 const polygon=await page.evaluate(ref=>{const lat=rainData.latitudes[ref.r],lon=rainData.longitudes[ref.c],dy=rainData.dlat*.49,dx=rainData.dlon*.49;return [[lat-dy,lon-dx],[lat-dy,lon+dx],[lat+dy,lon+dx],[lat+dy,lon-dx]]},reference);
 await page.evaluate(points=>points.forEach(([lat,lng])=>map.fire('click',{latlng:L.latLng(lat,lng)})),polygon);
 if(await page.locator('#finishAreaPolygon').isVisible())await page.click('#finishAreaPolygon');
 await page.waitForFunction(()=>$('applyAreaDrawing').hidden===false);await applyArea();await page.waitForFunction(()=>analysisAreaName==='Drawn polygon');
 assert.deepEqual(await page.evaluate(()=>rainSelection.cells.map(({r,c})=>[r,c])),[[reference.r,reference.c]]);
 await page.selectOption('#analysisAreaMode','rectangle');await dragRectangleInMap(70,70,125,125);await applyArea();
 await page.waitForFunction(()=>analysisAreaName==='Drawn rectangle'&&rainAnalysis.gridCells===0);
 assert.match(await page.textContent('#analysisAreaMessage'),/No archived rainfall grid cells/);
 await page.click('#resetAnalysisArea');await page.selectOption('#rainChartStatistic','maximum');assert.equal(await page.evaluate(()=>analysisGeometry),null);
 assert.equal(basinRequests,0);assert.equal(await page.isChecked('#drainageBasins'),false);
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);
 async function chartCursorUtc(){return await page.evaluate(()=>{const line=[...$('rainChart').querySelectorAll('line')].find(el=>el.getAttribute('stroke')==='#fff');if(!line)return null;const t0=Date.parse(rainData.times[0].utc),t1=Date.parse(rainData.times.at(-1).utc),x=Number(line.getAttribute('x1'));return new Date(t0+(x-66)/(1100-66-78)*(t1-t0)).toISOString()})}
 async function nearestRainUtc(anchor){return await page.evaluate(anchor=>rainData.times.reduce((best,row)=>Math.abs(Date.parse(row.utc)-Date.parse(anchor))<Math.abs(Date.parse(best.utc)-Date.parse(anchor))?row:best).utc,anchor)}
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST')&&data&&rainData);
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);
 let expectedAnchor=await page.evaluate(()=>selectedUtc);assert.ok(Math.abs(Date.parse(await chartCursorUtc())-Date.parse(await nearestRainUtc(expectedAnchor)))<1000);
 await page.locator('#time').evaluate(el=>{el.value='37';el.dispatchEvent(new Event('input',{bubbles:true}))});
 expectedAnchor=await page.evaluate(()=>selectedUtc);assert.ok(Math.abs(Date.parse(await chartCursorUtc())-Date.parse(await nearestRainUtc(expectedAnchor)))<1000);
 await page.selectOption('#mode','ever');expectedAnchor=await page.evaluate(()=>selectedUtc);assert.ok(Math.abs(Date.parse(await chartCursorUtc())-Date.parse(await nearestRainUtc(expectedAnchor)))<1000);
 await page.check('#showCrest');assert.ok(await page.locator('#rainChart path[stroke="#a0e28b"]').count()>0);
 const beforeClick=await page.evaluate(()=>selectedUtc);await page.locator('#chartHit').click({position:{x:720,y:150}});
 await page.waitForFunction(before=>selectedUtc!==before,beforeClick);
 const clickedAnchor=await page.evaluate(()=>({utc:selectedUtc,idx:Number($('time').value),mapUtc:data.times[Number($('time').value)].utc}));
 assert.equal(clickedAnchor.utc,clickedAnchor.mapUtc);assert.ok(Math.abs(Date.parse(await chartCursorUtc())-Date.parse(await nearestRainUtc(clickedAnchor.utc)))<1000);
 await page.selectOption('#product','rainfall');assert.equal(await page.isChecked('#showCrest'),true);
 assert.equal(await page.locator('#rainChart path[stroke="#a0e28b"]').count()>0,true);
 await page.selectOption('#product','crest');assert.equal(await page.isChecked('#showCrest'),true);
 await page.selectOption('#product','rainfall');
 // Low-bin cells must leave the basemap exposed in every product/display mode.
 for(const product of ['rainfall','crest']){
  await page.selectOption('#product',product);
  await page.waitForFunction(p=>$('product').value===p&&(p==='rainfall'?rainData:data),product);
  for(const mode of (product==='rainfall'?['cumulative','one_hour','three_hour']:['frame','ever'])){
   await page.selectOption(product==='rainfall'?'#rainMode':'#mode',mode);
   for(const index of ['0','3','max']){
    await page.locator('#time').evaluate((el,ix)=>{el.value=ix==='max'?el.max:ix;el.dispatchEvent(new Event('input',{bubbles:true}));},index);
    const result=await page.evaluate(()=>{
     const grid=currentGrid(),threshold=$('product').value==='rainfall'?0.1:200;
     const expected=grid.frame?grid.frame.flat().filter(v=>v!==null&&v>=threshold).length:0;
     return {expected,actual:layer.getLayers().length,gray:layer.getLayers().filter(cell=>['#a1aab5','#434958'].includes(cell.options.fillColor)).length};
    });
    assert.equal(result.gray,0,product+' '+mode+' '+index+' contains gray product cells');
    assert.equal(result.actual,result.expected,product+' '+mode+' '+index+' lost meaningful colored cells');
    assert.ok(await page.evaluate(()=>layer.getLayers().every(cell=>cell.options.fillOpacity===Number($('productOpacity').value)/100)),product+' opacity differs');
   }
  }
 }
 await page.selectOption('#product','rainfall');await page.selectOption('#rainMode','cumulative');
 async function checkLabels(level){
  await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress);
  const details=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.basin-name')].filter(el=>getComputedStyle(el).visibility!=='hidden');
   return els.map(el=>({text:el.textContent,interactive:getComputedStyle(el).pointerEvents,level:el.dataset.hucLevel,rect:el.getBoundingClientRect().toJSON()}));
  });
  assert.ok(details.length>0,'No visible basin names');
  assert.ok(details.every(d=>d.level===String(level)&&d.text.trim()&&d.interactive==='none'));
  for(let i=0;i<details.length;i++)for(let j=i+1;j<details.length;j++){
   const a=details[i].rect,b=details[j].rect;
   if(!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top))console.log('Overlapping labels:',details[i],details[j]);
   assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'Basin labels overlap');
  }
  return details.map(d=>d.text);
 }
 const before=await page.evaluate(()=>({product:$('product').value,time:$('time').value,zoom:map.getZoom(),center:map.getCenter(),current:$('rainCurrent').textContent}));
 const t=Date.now();await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('hydrologic units'));
 const after=await page.evaluate(()=>({product:$('product').value,time:$('time').value,zoom:map.getZoom(),center:map.getCenter(),current:$('rainCurrent').textContent}));
 assert.deepEqual(after,before);console.log('Pearl toggle preserves product/time/zoom/statistics; load ms',Date.now()-t);
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 console.log('Pearl regional:',await page.textContent('#basinStatus'));
 const n=await page.locator('.drainage-basin-line').count();assert.ok(n>0);
 const pearlNames=await checkLabels(10);
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 assert.equal(await page.locator('.drainage-basin-line').count(),n);await checkLabels(10);
 await page.selectOption('#mode','frame');
 await page.locator('#time').evaluate(el=>{el.value=3;el.dispatchEvent(new Event('input',{bubbles:true}))});
 assert.equal(await page.locator('.drainage-basin-line').count(),n);await checkLabels(10);
 await page.locator('#productOpacity').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});
 const styles=await page.locator('.drainage-basin-line').first().evaluate(el=>({opacity:el.getAttribute('stroke-opacity'),fill:el.getAttribute('fill')}));
 assert.equal(styles.opacity,'0.95');assert.equal(styles.fill,'none');
 await page.selectOption('#product','rainfall');await page.selectOption('#rainMode','one_hour');
 const pearlRequestCount=basinRequests;
 await page.evaluate(()=>{map.setZoom(12,{animate:false});});await page.waitForFunction(()=>!map._animatingZoom);
 assert.equal(await page.locator('.drainage-basin-line').count(),n);
 assert.equal(basinRequests,pearlRequestCount);assert.ok(!basinAssetPaths.some(p=>p.endsWith('/huc12.geojson')));
 console.log('Pearl zoom 12 retains HUC10:',await page.textContent('#basinStatus'));await checkLabels(10);
 const zoomedTarget=await page.evaluate(()=>{
  const pane=map.getPane('drainageBasins'),rect=$('map').getBoundingClientRect();
  for(const el of pane.querySelectorAll('path')){const length=el.getTotalLength();for(let d=0;d<length;d+=Math.max(1,length/1000)){
   const p=el.getPointAtLength(d),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());
   if(q.x>rect.left+30&&q.x<rect.right-30&&q.y>rect.top+30&&q.y<rect.bottom-30)return{x:q.x,y:q.y};
  }}return null;
 });assert.ok(zoomedTarget,'HUC10 paths remain rendered beyond zoom 11');
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 const target=await page.evaluate(()=>{
  const pane=map.getPane('drainageBasins');const mapRect=$('map').getBoundingClientRect();
  for(const el of pane.querySelectorAll('path')){
   const length=el.getTotalLength();for(let d=0;d<length;d+=Math.max(1,length/1000)){
    const p=el.getPointAtLength(d),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());
    if(q.x>mapRect.left+30&&q.x<mapRect.right-30&&q.y>mapRect.top+30&&q.y<mapRect.bottom-30)return {x:q.x,y:q.y,index:[...pane.querySelectorAll('path')].indexOf(el)};
   }
  }return null;
 });assert.ok(target);
 async function clickBasinOutline(point){await page.evaluate(p=>{const paths=[...map.getPane('drainageBasins').querySelectorAll('path')];paths[p.index].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:p.x,clientY:p.y}))},point)}
 async function findGridBasinPoint(excludeHuc=null){return page.evaluate(exclude=>{
  const pane=map.getPane('drainageBasins'),features=Object.values(map._layers).filter(layer=>layer?.feature&&layer._path&&pane.contains(layer._path));
  const rect=$('map').getBoundingClientRect();
  for(const layer of features){const huc=String(layer.feature.properties.huc);if(huc===exclude)continue;
   const cells=areaAnalysis.mask(rainData,layer.feature).cells;
   for(const {r,c} of cells){
    const lat=rainData.latitudes[r],lon=rainData.longitudes[c],hasData=rainData.frames.cumulative.some(frame=>frame?.[r]?.[c]!=null);
    if(!hasData)continue;
    const point=map.latLngToContainerPoint([lat,lon]),x=rect.left+point.x,y=rect.top+point.y,element=document.elementFromPoint(x,y),hitLayer=features.find(candidate=>candidate._path===element),hitHuc=String(hitLayer?.feature?.properties?.huc||'');
    if(element?.classList.contains('drainage-basin-line')&&hitHuc!==exclude&&hitHuc)return{x,y,lat,lon,huc:hitHuc,name:hitLayer.feature.properties.name};
   }
  }return null;
 },excludeHuc)}
 await clickBasinOutline(target);await page.waitForSelector('.leaflet-popup-content');
 assert.match(await page.textContent('.leaflet-popup-content'),/HUC10: \d{10}/);assert.equal(await page.textContent('#pinCount'),'0 pins');
 console.log('Real SVG outline click popup:',await page.textContent('.leaflet-popup-content'));
 const entireEventRainfall=await page.textContent('#rainEvent');
 await page.selectOption('#analysisAreaMode','basin');await page.waitForFunction(()=>$('basinStatus').textContent.includes('hydrologic units'));
 const basinA=await findGridBasinPoint();assert.ok(basinA,'find a rainfall-covered HUC10 basin A');
 async function selectBasinAt(point){
  const receivesClick=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.classList.contains('drainage-basin-line')===true,point);
  assert.equal(receivesClick,true,'real map click inside HUC10 '+point.huc+' reaches its basin polygon');
  await page.mouse.click(point.x,point.y);await page.waitForFunction(huc=>analysisAreaName.includes('HUC10 '+huc),point.huc,{timeout:3000});
  const clicked=await page.evaluate(()=>({selected:analysisAreaName,mode:$('analysisAreaMode').value,summary:$('analysisAreaSummary').textContent}));
  assert.ok(clicked.selected.includes('HUC10 '+point.huc),'real map click should select '+point.huc+'; observed '+JSON.stringify(clicked));
  assert.equal(await page.evaluate(()=>analysisAreaType),'basin');assert.ok(await page.evaluate(()=>rainSelection.cells.length>0));assert.equal(await page.evaluate(()=>rainAnalysis.gridCells),await page.evaluate(()=>rainSelection.cells.length));
 }
 await selectBasinAt(basinA);assert.match(await page.textContent('#analysisAreaSummary'),new RegExp('HUC10 '+basinA.huc));
 const basinAStats=await page.evaluate(()=>({event:$('rainEvent').textContent,cells:rainAnalysis.gridCells,max:rainAnalysis.maxEvent?.value}));
 assert.ok(basinAStats.cells<await page.evaluate(()=>rainData.latitudes.length*rainData.longitudes.length),'selected basin statistics use only its HUC10 geometry');
 assert.notEqual(basinAStats.max,null,'selected basin rainfall maximum is populated');
 await page.click('#resetAnalysisArea');assert.equal(await page.evaluate(()=>analysisGeometry),null);assert.equal(await page.textContent('#rainEvent'),entireEventRainfall);assert.equal(await page.isChecked('#drainageBasins'),true);
 await page.selectOption('#analysisAreaMode','basin');
 const basinB=await findGridBasinPoint(basinA.huc);assert.ok(basinB&&basinB.huc!==basinA.huc,'find a different rainfall-covered HUC10 basin B');
 await selectBasinAt(basinB);assert.match(await page.textContent('#analysisAreaSummary'),new RegExp('HUC10 '+basinB.huc));
 const basinBStats=await page.evaluate(()=>({event:$('rainEvent').textContent,cells:rainAnalysis.gridCells,max:rainAnalysis.maxEvent?.value}));
 assert.ok(basinBStats.cells<await page.evaluate(()=>rainData.latitudes.length*rainData.longitudes.length));
 assert.notEqual(basinBStats.max,null,'replacement basin rainfall maximum is populated');
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 await page.locator('#time').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.selectOption('#product','rainfall');await page.waitForFunction(()=>$('status').textContent.includes('rainfall'));
 assert.match(await page.textContent('#analysisAreaSummary'),new RegExp('HUC10 '+basinB.huc));
 await selectBasinAt(basinA);assert.match(await page.textContent('#analysisAreaSummary'),new RegExp('HUC10 '+basinA.huc));
 for(let cycle=0;cycle<3;cycle++){
  await page.click('#resetAnalysisArea');assert.equal(await page.evaluate(()=>analysisGeometry),null);assert.equal(await page.isChecked('#drainageBasins'),true);
  await page.selectOption('#analysisAreaMode','basin');await selectBasinAt(cycle%2?basinA:basinB);
 }
 assert.notEqual(basinAStats.event,'—','selected basin rainfall summary is populated');
 await page.click('#resetAnalysisArea');
 // Select a complete rainfall frame before testing sampling (early one-hour frames may be null).
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 // Pin sampling still works through transparent interiors; map's ordinary click handler is unchanged.
 await page.evaluate(()=>{const grid=currentGrid();outer:for(let r=0;r<grid.frame.length;r++)for(let c=0;c<grid.frame[r].length;c++)if(grid.frame[r][c]!==null){map.fire('click',{latlng:L.latLng(grid.dataset.latitudes[r],grid.dataset.longitudes[c])});break outer;}});
 assert.equal(await page.textContent('#pinCount'),'1 pin');
 await page.uncheck('#drainageBasins');assert.equal(await page.locator('.drainage-basin-line').count(),0);assert.equal(await page.locator('.basin-name:visible').count(),0);await page.waitForFunction(()=>document.querySelectorAll('.basin-name').length===0);
 // Turn the overlay off while Leaflet is animating a resolution change.
 await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 await page.evaluate(()=>{map.setZoom(12,{animate:true});$('drainageBasins').checked=false;$('drainageBasins').dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress&&document.querySelectorAll('.basin-name').length===0);
 assert.equal(await page.locator('.drainage-basin-line').count(),0);assert.equal(await page.textContent('#basinStatus'),'Off');
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});
 failAssets=true;await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));assert.ok(await page.locator('.drainage-basin-line').count()>0);failAssets=false;
 await page.selectOption('#analysisAreaMode','rectangle');await dragRectangleInMap(80,80,140,140);await applyArea();await page.waitForFunction(()=>analysisGeometry!==null);
 let unblockBoundary;await page.route('**/data/events/2026-10-31_jefferson-parish-la/boundary.geojson',async route=>{await page.evaluate(()=>window.__boundaryStarted=true);await new Promise(resolve=>unblockBoundary=resolve);return route.fulfill({path:path.join(root,'data/events/2026-10-31_jefferson-parish-la/boundary.geojson'),contentType:'application/json'})});
 const switchingEvent=page.selectOption('#eventSelect','2026-10-31_jefferson-parish-la');await page.waitForFunction(()=>window.__boundaryStarted&&activeEvent.id==='2026-10-31_jefferson-parish-la');
 assert.equal(await page.evaluate(()=>analysisGeometry),null,'event selection resets the custom area before the boundary response');assert.notEqual(await page.evaluate(()=>rainData?.summary.start_utc), '2026-10-31T18:00:00+00:00','old rainfall archive is not shown while the boundary response is pending');
 unblockBoundary();await switchingEvent;await page.unroute('**/data/events/2026-10-31_jefferson-parish-la/boundary.geojson');
 await page.waitForFunction(()=>activeEvent.id.includes('jefferson')&&rainData&&$('status').textContent.includes('rainfall'));
 await page.waitForFunction(()=>$('basinStatus').textContent.includes('hydrologic units'));
 assert.equal(await page.isChecked('#drainageBasins'),true);
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 console.log('Jefferson + six neighbors:',await page.textContent('#basinStatus'));
 const jn=await page.locator('.drainage-basin-line').count();
 assert.notDeepEqual(await checkLabels(10),pearlNames);
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 assert.equal(await page.locator('.drainage-basin-line').count(),jn);await checkLabels(10);
 const jeffersonRequestCount=basinRequests;
 await page.evaluate(()=>{map.setZoom(12,{animate:false});});await page.waitForFunction(()=>!map._animatingZoom);
 assert.equal(await page.locator('.drainage-basin-line').count(),jn);assert.equal(basinRequests,jeffersonRequestCount);
 console.log('Jefferson zoom 12 retains HUC10:',await page.textContent('#basinStatus'));await checkLabels(10);
 await page.selectOption('#analysisAreaMode','basin');
 const jeffersonTarget=await findGridBasinPoint();assert.ok(jeffersonTarget);
 await page.mouse.click(jeffersonTarget.x,jeffersonTarget.y);
 await page.waitForFunction(huc=>analysisAreaName.includes('HUC10 '+huc),jeffersonTarget.huc);
 assert.equal(await page.evaluate(()=>rainAnalysis.gridCells),await page.evaluate(()=>rainSelection.cells.length));
 await page.click('#resetAnalysisArea');assert.equal(await page.isChecked('#drainageBasins'),true);
 await page.evaluate(()=>{map.panBy([160,80],{animate:false});});await checkLabels(10);
 await page.selectOption('#product','rainfall');await page.locator('#productOpacity').evaluate(el=>{el.value=65;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.selectOption('#rainMode','cumulative');
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.screenshot({path:'work/jefferson-basins.png',fullPage:true});
 await page.selectOption('#eventSelect','2026-10-31_pearl-river-ms');await page.waitForFunction(()=>rainData&&activeEvent.id.includes('pearl')&&$('status').textContent.includes('rainfall'));
 await page.selectOption('#eventSelect','test-rain-only');await page.waitForFunction(()=>activeEvent.id==='test-rain-only'&&rainData&&$('status').textContent.includes('rainfall'));
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);assert.equal(await page.isDisabled('#showCrest'),true);assert.match(await page.getAttribute('#showCrest','title'),/unavailable/i);
 let missingRainRequests=0;await page.route('**/data/no-such-event/rainfall.json',route=>{missingRainRequests++;return route.fulfill({status:404,body:'missing'})});
 await page.selectOption('#eventSelect','test-no-rain');await page.waitForFunction(()=>$('rainChartMessage').textContent.includes('unavailable'));
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);assert.equal(missingRainRequests,1);
 await page.selectOption('#eventSelect','test-rain-only');await page.waitForFunction(()=>activeEvent.id==='test-rain-only'&&rainData&&$('status').textContent.includes('rainfall'));
 await page.uncheck('#drainageBasins');
 assert.equal(await page.locator('.drainage-basin-line').count(),0);
 // New page has no loaded asset cache: a static fetch failure must leave products usable.
 failAssets=true;await page.reload();await page.waitForFunction(()=>rainData&&$('status').textContent.includes('rainfall'));
 await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('unavailable'));
 assert.equal(await page.locator('.drainage-basin-line').count(),0);
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 await page.selectOption('#mode','ever');await page.waitForFunction(()=>layer.getLayers().length>0);
 assert.deepEqual(errors,[]);console.log('Offline static failure isolated; product remains functional; no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
