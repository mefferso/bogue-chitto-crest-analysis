const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=process.cwd();
const gapRainSource=JSON.parse(fs.readFileSync(path.join(root,'data/events/2026-10-31_jefferson-parish-la/rainfall.json'),'utf8'));
const missingCrestUtc=gapRainSource.times[4].utc;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100},hasTouch:true});
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
    index.events.push({id:'test-gap',name:'Missing frame test',label:'Missing frame test',start_utc:'2026-10-31T19:00:00Z',end_utc:'2026-11-01T08:00:00Z',data_dir:'fixtures/test-gap',products:{rainfall:true,crest:true}});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(index)});
   }
   if(name==='fixtures/test-gap/rainfall.json'){
    const archive=JSON.parse(fs.readFileSync(path.join(root,'data/events/2026-10-31_jefferson-parish-la/rainfall.json'),'utf8'));
    archive.frames.three_hour[4]=null;return route.fulfill({contentType:'application/json',body:JSON.stringify(archive)});
   }
   if(name==='fixtures/test-gap/dashboard.json'){
    const archive=JSON.parse(fs.readFileSync(path.join(root,'data/events/2026-10-31_jefferson-parish-la/dashboard.json'),'utf8'));
    const ix=archive.times.findIndex(row=>Date.parse(row.utc)===Date.parse(missingCrestUtc));
    assert.ok(ix>=0,'fixture target aligns to an original CREST timestamp');archive.times.splice(ix,1);archive.frames.splice(ix,1);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(archive)});
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
 for(const mode of ['rainfall','crest','swipe']){
  const choice=page.locator(`[name="productMode"][value="${mode}"]`);
  assert.equal(await choice.isVisible(),true,`${mode} is a visible product choice`);
  await choice.check();assert.equal(await choice.isChecked(),true,`${mode} is selected`);
  assert.equal(await page.locator('[name="productMode"]:checked').count(),1,'product choices are mutually exclusive');
  if(mode==='swipe'){
   assert.equal(await page.locator('#swipeDivider').isVisible(),true,'swipe divider is visible');
   assert.ok(Math.abs(await page.evaluate(()=>Number($('swipeDivider').dataset.position||50))-50)<0.1,'initial divider position is 50%');
   const pinsBeforeSwipeHandle=await page.evaluate(()=>samples.length);
   const mapBox=await page.locator('#map').boundingBox(),handle=await page.locator('#swipeDivider').boundingBox();
   await page.mouse.move(handle.x+handle.width/2,mapBox.y+mapBox.height/2);await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width*.24,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
   assert.ok(Math.abs((await page.evaluate(()=>Number($('swipeDivider').dataset.position)))-24)<1,'real mouse drag moves divider left');
   await page.mouse.move(mapBox.x+mapBox.width*.24,mapBox.y+mapBox.height/2);await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width*.76,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
   assert.ok(Math.abs((await page.evaluate(()=>Number($('swipeDivider').dataset.position)))-76)<1,'real mouse drag moves divider right');
   const centeredHandle=await page.locator('#swipeDivider').boundingBox();await page.mouse.move(centeredHandle.x+centeredHandle.width/2,mapBox.y+mapBox.height/2);await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width*.5,mapBox.y+mapBox.height/2,{steps:4});await page.mouse.up();
   await page.locator('#swipeDivider').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#swipeDivider').getAttribute('aria-valuenow'),'52');await page.keyboard.press('Home');assert.equal(await page.locator('#swipeDivider').getAttribute('aria-valuenow'),'0');await page.keyboard.press('End');assert.equal(await page.locator('#swipeDivider').getAttribute('aria-valuenow'),'100');
   for(let i=0;i<25;i++)await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#swipeDivider').getAttribute('aria-valuenow'),'50','keyboard restores the divider to center');
   const touch=await page.context().newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
   const touchBox=await page.locator('#map').boundingBox(),touchStart={x:touchBox.x+touchBox.width*.5,y:touchBox.y+touchBox.height*.5};
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touchStart,radiusX:8,radiusY:8,force:1}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchBox.x+touchBox.width*.62,y:touchStart.y,radiusX:8,radiusY:8,force:1}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(Math.abs(Number(await page.locator('#swipeDivider').getAttribute('aria-valuenow'))-62)<2,'touch drag moves the divider: '+await page.locator('#swipeDivider').getAttribute('aria-valuenow'));await touch.detach();
   assert.equal(await page.evaluate(()=>samples.length),pinsBeforeSwipeHandle,'swipe-handle mouse/touch/keyboard interaction does not drop sample pins');
   for(let i=0;i<6;i++)await page.keyboard.press('ArrowLeft');
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile layout has no horizontal page overflow');await page.setViewportSize({width:1440,height:1100});
   const wetIndex=await page.evaluate(()=>activeTimes().findIndex(({utc})=>{const r=archiveTimeline.resolveRainfall(rainData.times,utc),c=archiveTimeline.resolveCrest(data.times,utc);return r&&c&&rainData.frames.cumulative[r.index]?.flat().some(v=>v>=.1)&&data.frames[c.index]?.flat().some(v=>v>=200)}));
   assert.ok(wetIndex>=0,'fixture has a native time with colored frames in both products');
   await page.evaluate(index=>{selectedUtc=activeTimes()[index].utc;$('time').value=index;drawRain();draw()},wetIndex);
   const viewBeforePan=await page.evaluate(()=>{const center=map.getCenter();return{center:[center.lat,center.lng],zoom:map.getZoom()}}),startX=mapBox.x+mapBox.width*.88,startY=mapBox.y+mapBox.height*.8;
   await page.mouse.move(startX,startY);await page.mouse.down();await page.mouse.move(startX-45,startY-35,{steps:5});await page.mouse.up();
   await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress);
   assert.notDeepEqual(await page.evaluate(()=>{const center=map.getCenter();return[center.lat,center.lng]}),viewBeforePan.center,'real mouse pan changes the shared map view');
   await page.locator('.leaflet-control-zoom-in').click();await page.waitForFunction(()=>!map._animatingZoom);
   const clipAlignment=await page.evaluate(()=>{const mapRect=map.getContainer().getBoundingClientRect(),rain=map.getPane('rainfallProduct'),crest=map.getPane('crestProduct'),rainRect=rain.getBoundingClientRect(),crestRect=crest.getBoundingClientRect(),rainRight=Number(getComputedStyle(rain).clipPath.match(/inset\(0px ([\d.]+)px/)[1]),crestLeft=Number(getComputedStyle(crest).clipPath.match(/inset\(0px 0px 0px ([\d.]+)px/)[1]),cut=mapRect.left+mapRect.width*swipePosition/100;return{rainError:Math.abs((rainRect.width-rainRight)-(cut-rainRect.left)),crestError:Math.abs(crestLeft-(cut-crestRect.left)),position:swipePosition}});
   assert.ok(clipAlignment.rainError<1&&clipAlignment.crestError<1&&Math.abs(clipAlignment.position-50)<.1,'product clips stay screen-aligned through pan/zoom: '+JSON.stringify(clipAlignment));
   await page.evaluate(view=>{map.setView(view.center,view.zoom,{animate:false})},viewBeforePan);
   const frameCounts=await page.evaluate(()=>({rain:rainLayer.getLayers().length,crest:crestLayer.getLayers().length}));
   assert.ok(frameCounts.rain>0&&frameCounts.crest>0,'swipe renders rainfall and CREST layers together: '+JSON.stringify(frameCounts));
   const reuse=await page.evaluate(next=>{window.__rainCell=rainLayer.getLayers()[0];$('mode').value='ever';renderSelectedTime();window.__crestCell=crestLayer.getLayers()[0];setArchiveIndex(next);return{rain:window.__rainCell===rainLayer.getLayers()[0],crest:window.__crestCell===crestLayer.getLayers()[0]}},Math.min(wetIndex+1,Number(await page.locator('#time').getAttribute('max'))));
   assert.deepEqual(reuse,{rain:true,crest:true},'product grid cell layers are reused across animation frames');
   await page.evaluate(index=>{$('mode').value='frame';setArchiveIndex(index)},wetIndex);
   await page.locator('#rainOpacity').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}))});
   await page.locator('#crestOpacity').evaluate(el=>{el.value='70';el.dispatchEvent(new Event('input',{bubbles:true}))});
   assert.equal(await page.evaluate(()=>rainLayer.getLayers().filter(cell=>cell._productVisible).every(cell=>cell.options.fillOpacity===.4)),true,'rainfall opacity is independent');
   assert.equal(await page.evaluate(()=>crestLayer.getLayers().filter(cell=>cell._productVisible).every(cell=>cell.options.fillOpacity===.7)),true,'CREST opacity is independent');
   await page.locator('#rainOpacity').evaluate(el=>{el.value='85';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.locator('#crestOpacity').evaluate(el=>{el.value='85';el.dispatchEvent(new Event('input',{bubbles:true}))});
   const sideSamples=await page.evaluate(()=>{
    const mapBox=$('map').getBoundingClientRect(),size=map.getSize();$('mode').value='frame';$('rainMode').value='cumulative';
    for(let i=0;i<activeTimes().length;i++){
     const utc=activeTimes()[i].utc,r=archiveTimeline.resolveRainfall(rainData.times,utc),c=archiveTimeline.resolveCrest(data.times,utc);if(!r||!c)continue;
     const rain=rainData.frames.cumulative[r.index],crest=data.frames[c.index],rainPoints=[],crestPoints=[];
     for(let y=0;y<rainData.latitudes.length;y++)for(let x=0;x<rainData.longitudes.length;x++){
      const point=map.latLngToContainerPoint([rainData.latitudes[y],rainData.longitudes[x]]);
      if(point.x<4||point.y<4||point.x>size.x-4||point.y>size.y-4)continue;
      if(rain[y]?.[x]>=.1&&Number.isFinite(crest[y]?.[x]))rainPoints.push(point);if(crest[y]?.[x]>=200&&Number.isFinite(rain[y]?.[x]))crestPoints.push(point);
     }
     const rainPoint=rainPoints.find(point=>crestPoints.some(other=>point.x<other.x));
     const crestPoint=rainPoint&&crestPoints.find(point=>point.x>rainPoint.x);if(!crestPoint)continue;
     const cut=(rainPoint.x+crestPoint.x)/2;selectedUtc=utc;$('time').value=i;setSwipePosition(cut/size.x*100);renderSelectedTime();
     return {rain:{x:mapBox.left+rainPoint.x,y:mapBox.top+rainPoint.y},crest:{x:mapBox.left+crestPoint.x,y:mapBox.top+crestPoint.y}};
    }
    return {};
   });
   assert.ok(sideSamples.rain&&sideSamples.crest,'both products have a colored sample point on their visible side: '+JSON.stringify(sideSamples));
   await page.mouse.click(sideSamples.rain.x,sideSamples.rain.y);await page.mouse.click(sideSamples.crest.x,sideSamples.crest.y);
   const expectedSideProducts=async()=>page.evaluate(()=>samples.map(entry=>{const point=map.latLngToContainerPoint([entry.lat,entry.lng]);return point.x<map.getSize().x*swipePosition/100?'rainfall':'crest'}));
   assert.deepEqual(await expectedSideProducts(),['rainfall','crest'],'mouse clicks initially drop pins on the products visible under each location');
   const assertSideLabels=async products=>{const actualProducts=await expectedSideProducts();if(products)assert.deepEqual(actualProducts,products);const expected=await page.evaluate(()=>samples.map(entry=>{const point=map.latLngToContainerPoint([entry.lat,entry.lng]),product=point.x<map.getSize().x*swipePosition/100?'rainfall':'crest',value=sampleAt(entry,product);return value?product==='rainfall'?Number(value.value).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})+' in.':fmt(value.value)+' '+value.unit:'—'}));const labels=await page.locator('.pin-label').allTextContents();assert.deepEqual(labels,expected,'pin values refresh from the currently revealed product');for(let i=0;i<actualProducts.length;i++)if(labels[i]!=='—')assert.ok(actualProducts[i]==='rainfall'?/\d[\d,]*\.\d in\.$/.test(labels[i]):/\d[\d,]*(?:\.\d)? cfs\/mi²$/.test(labels[i]),'pin label follows visible '+actualProducts[i]+' product: '+labels[i])};
   const initialPinState=await page.evaluate(()=>{window.__pinMarkerRefs=samples.map(pin=>pinMarkers.get(pin.id));return samples.map(({lat,lng})=>({lat,lng}))});
   const initialSwipePosition=await page.evaluate(()=>swipePosition),currentMapBox=await page.locator('#map').boundingBox(),dividerBox=await page.locator('#swipeDivider').boundingBox(),pinPixels=await page.evaluate(()=>samples.map(entry=>map.latLngToContainerPoint([entry.lat,entry.lng]).x));
   const pinLeft=currentMapBox.x+Math.max(2,Math.min(...pinPixels)-currentMapBox.width*.02),pinRight=currentMapBox.x+Math.min(currentMapBox.width-2,Math.max(...pinPixels)+currentMapBox.width*.02);
   await page.mouse.move(dividerBox.x+dividerBox.width/2,currentMapBox.y+currentMapBox.height/2);await page.mouse.down();await page.mouse.move(pinLeft,currentMapBox.y+currentMapBox.height/2,{steps:5});await assertSideLabels(['crest','crest']);
   await page.mouse.move(pinRight,currentMapBox.y+currentMapBox.height/2,{steps:8});await assertSideLabels(['rainfall','rainfall']);
   await page.mouse.move(currentMapBox.x+currentMapBox.width*initialSwipePosition/100,currentMapBox.y+currentMapBox.height/2,{steps:8});await page.mouse.up();await assertSideLabels(['rainfall','crest']);
   assert.deepEqual(await page.evaluate(()=>samples.map(({lat,lng})=>({lat,lng}))),initialPinState,'moving the divider keeps each pin at the same geographic coordinates');
   assert.equal(await page.evaluate(()=>samples.every((pin,index)=>pinMarkers.get(pin.id)===window.__pinMarkerRefs[index])),true,'divider changes reuse existing marker instances');
   const pinLabels=await page.locator('.pin-label').allTextContents();
   const expectedPinLabels=await page.evaluate(()=>samples.map(entry=>{const point=map.latLngToContainerPoint([entry.lat,entry.lng]),product=point.x<map.getSize().x*swipePosition/100?'rainfall':'crest',value=sampleAt(entry,product);return value?product==='rainfall'?Number(value.value).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})+' in.':fmt(value.value)+' '+value.unit:'—'}));
   assert.deepEqual(pinLabels,expectedPinLabels,'visible pins contain only sampled values and units');
   const pinStyle=await page.locator('.pin-label').first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,border:getComputedStyle(el).borderTopColor}));
   assert.deepEqual(pinStyle,{background:'rgb(255, 255, 255)',color:'rgb(0, 0, 0)',border:'rgb(0, 0, 0)'},'pin labels use a white background and black ring');
   await page.evaluate(()=>window.scrollTo(0,0));const pinView=await page.evaluate(()=>{const center=map.getCenter();return{center:[center.lat,center.lng],zoom:map.getZoom()}}),panBox=await page.locator('#map').boundingBox();
   await page.mouse.move(panBox.x+panBox.width*.08,panBox.y+panBox.height*.83);await page.mouse.down();await page.mouse.move(panBox.x+panBox.width*.22,panBox.y+panBox.height*.83,{steps:6});await page.mouse.up();
   await page.waitForFunction(()=>!map._panAnim?._inProgress);await assertSideLabels();
   await page.locator('.leaflet-control-zoom-in').click();await page.waitForFunction(()=>!map._animatingZoom);await assertSideLabels();
   await page.setViewportSize({width:980,height:1000});await assertSideLabels();await page.setViewportSize({width:1440,height:1100});await assertSideLabels();
   assert.deepEqual(await page.evaluate(()=>samples.map(({lat,lng})=>({lat,lng}))),initialPinState,'pan and zoom preserve pin geography');
   await page.evaluate(view=>{map.setView(view.center,view.zoom,{animate:false})},pinView);await assertSideLabels();
   await page.locator('#time').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});await assertSideLabels();const beforePlayback=await page.evaluate(()=>selectedUtc);
   await page.click('#playPause');await page.waitForFunction(before=>selectedUtc!==before&&$('playPause').dataset.playing==='true',beforePlayback,{timeout:3000});await assertSideLabels();await page.click('#playPause');await page.evaluate(()=>window.scrollTo(0,0));
   await page.click('#clearPins');
   await page.screenshot({path:'work/swipe-product-check.png'});
  } else assert.equal(await page.locator('#swipeDivider').isVisible(),false,`${mode} hides swipe divider`);
  await page.check('#drainageBasins');assert.equal(await page.isChecked('#drainageBasins'),true,`basins can be enabled in ${mode}`);
  await page.uncheck('#drainageBasins');assert.equal(await page.isChecked('#drainageBasins'),false,`basins can be disabled in ${mode}`);
  assert.equal(await choice.isChecked(),true,`basin toggle does not change ${mode}`);
 }
 await page.click('#basinInfo');assert.equal(await page.locator('#basinHelp').isVisible(),true);assert.match(await page.textContent('#basinHelp'),/RFC forecast basins or exact upstream contributing areas/);
 await page.locator('#basinInfo').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#basinHelp').isVisible(),false,'basin explanation toggles by keyboard');
 const infoBox=await page.locator('#basinInfo').boundingBox();await page.touchscreen.tap(infoBox.x+infoBox.width/2,infoBox.y+infoBox.height/2);assert.equal(await page.locator('#basinHelp').isVisible(),true,'basin explanation opens by touch');await page.touchscreen.tap(infoBox.x+infoBox.width/2,infoBox.y+infoBox.height/2);
 async function addSingleProductPin(product){
  await page.locator(`[name="productMode"][value="${product}"]`).check();
  if(product==='rainfall')await page.selectOption('#rainMode','cumulative');else await page.selectOption('#mode','frame');
  const candidate=await page.evaluate(product=>{
   const dataset=product==='rainfall'?rainData:data,frames=product==='rainfall'?rainData.frames.cumulative:data.frames,threshold=product==='rainfall'?.1:200,times=activeTimes(product),box=$('map').getBoundingClientRect();
   for(let i=0;i<times.length;i++){
    const sourceIndex=product==='rainfall'?i:archiveTimeline.resolveCrest(data.times,times[i].utc)?.index,frame=sourceIndex==null?null:frames[sourceIndex];if(!frame)continue;
    for(let y=0;y<dataset.latitudes.length;y++)for(let x=0;x<dataset.longitudes.length;x++)if(frame[y]?.[x]>=threshold){
     const pixel=map.latLngToContainerPoint([dataset.latitudes[y],dataset.longitudes[x]]);if(pixel.x>5&&pixel.y>5&&pixel.x<map.getSize().x-5&&pixel.y<map.getSize().y-5)return{index:i,lat:dataset.latitudes[y],lng:dataset.longitudes[x],x:box.left+pixel.x,y:box.top+pixel.y};
    }
   }
   return null;
  },product);
  assert.ok(candidate,product+' has a visible colored grid cell for real mouse sampling');
  await page.locator('#time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('input',{bubbles:true}))},candidate.index);
  const previousCount=await page.evaluate(()=>samples.length);
  await page.mouse.click(candidate.x,candidate.y);
  await page.waitForFunction(count=>samples.length>count,previousCount);
 }
 async function assertPinValues(){
  const expected=await page.evaluate(()=>samples.map(entry=>{
   const mapMode=$('product').value,point=map.latLngToContainerPoint([entry.lat,entry.lng]),product=mapMode==='swipe'?(point.x<map.getSize().x*swipePosition/100?'rainfall':'crest'):mapMode;let dataset,frame,unit;
   if(product==='rainfall'){
    dataset=rainData;unit='in';const resolved=mapMode==='rainfall'?{index:Number($('time').value)}:archiveTimeline.resolveRainfall(rainData.times,selectedUtc);frame=resolved?rainData.frames[$('rainMode').value]?.[resolved.index]:null;
   }else{
    dataset=data;unit='cfs/mi²';let index=mapMode==='crest'?Number($('time').value):mapMode==='swipe'?archiveTimeline.resolveCrest(data.times,selectedUtc)?.index:archiveTimeline.nearest(data.times,selectedUtc);frame=$('mode').value==='ever'?data.ever_max:index==null?null:data.frames[index];
   }
   if(!frame)return'—';const row=dataset.latitudes.reduce((best,value,i)=>Math.abs(value-entry.lat)<Math.abs(dataset.latitudes[best]-entry.lat)?i:best,0),col=dataset.longitudes.reduce((best,value,i)=>Math.abs(value-entry.lng)<Math.abs(dataset.longitudes[best]-entry.lng)?i:best,0),value=frame[row]?.[col];return value==null||!Number.isFinite(value)?'—':unit==='in'?Number(value).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})+' in.':fmt(value)+' '+unit;
  }));
  assert.deepEqual(await page.locator('.pin-label').allTextContents(),expected,'pins follow the visible product at their current location and archive time');
 }
 await addSingleProductPin('rainfall');await assertPinValues();
 const previousPinTime=await page.evaluate(()=>selectedUtc),nextRainIndex=await page.evaluate(()=>Math.min(Number($('time').value)+1,Number($('time').max)));
 assert.ok(nextRainIndex>Number(await page.locator('#time').inputValue()),'fixture offers another rainfall timestamp');
 await page.locator('#time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('input',{bubbles:true}))},nextRainIndex);
 assert.notEqual(await page.evaluate(()=>selectedUtc),previousPinTime,'timeline stepping changes the selected archive time');await assertPinValues();
 await page.locator('[name="productMode"][value="crest"]').check();await assertPinValues();
 await addSingleProductPin('crest');await assertPinValues();assert.equal(await page.evaluate(()=>samples.length),2);
 for(const product of ['swipe','rainfall','crest']){await page.locator(`[name="productMode"][value="${product}"]`).check();await assertPinValues()}
 await page.click('#clearPins');await page.waitForFunction(()=>document.querySelectorAll('.pin-label').length===0);assert.equal(await page.locator('.pin-label').count(),0,'clearing pins removes their compact labels');await page.evaluate(()=>window.scrollTo(0,0));
 await page.locator('[name="productMode"][value="crest"]').check();
 async function dragRectangle(points){
  await page.locator('#map').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>!map._animatingZoom&&!map._panAnim?._inProgress);
  const pixels=await page.evaluate(values=>{const rect=$('map').getBoundingClientRect();return values.map(([lat,lng])=>{const p=map.latLngToContainerPoint([lat,lng]);return{x:rect.left+p.x,y:rect.top+p.y}})},points);
  assert.ok(pixels.every(({x,y})=>x>=0&&y>=0&&x<1440&&y<1100),'rectangle drawing points are within the visible browser viewport: '+JSON.stringify(pixels));
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
 const originalDrawingView=await page.evaluate(()=>({center:map.getCenter().toArray(),zoom:map.getZoom()}));
 await page.evaluate(({lat,lon})=>{map.setView([lat,lon],10,{animate:false});return true},{lat:reference.lat,lon:reference.lon});
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
 await page.locator('[name="productMode"][value="crest"]').check();await page.check('#showCrest');assert.equal(await page.evaluate(()=>analysisGeometry!==null),true);
 assert.ok(await page.locator('#rainChart path[stroke="#a0e28b"]').count()>0);
 await page.locator('[name="productMode"][value="rainfall"]').check();await page.selectOption('#analysisAreaMode','polygon');
 const polygon=await page.evaluate(ref=>{const lat=rainData.latitudes[ref.r],lon=rainData.longitudes[ref.c],dy=rainData.dlat*.49,dx=rainData.dlon*.49;return [[lat-dy,lon-dx],[lat-dy,lon+dx],[lat+dy,lon+dx],[lat+dy,lon-dx]]},reference);
 const polygonPixels=await page.evaluate(points=>points.map(([lat,lng])=>{const rect=$('map').getBoundingClientRect(),point=map.latLngToContainerPoint([lat,lng]);return{x:rect.left+point.x,y:rect.top+point.y}}),polygon);
 for(const point of polygonPixels)await page.mouse.click(point.x,point.y);
 if(await page.locator('#finishAreaPolygon').isVisible())await page.click('#finishAreaPolygon');
 await page.waitForFunction(()=>$('applyAreaDrawing').hidden===false);await applyArea();await page.waitForFunction(()=>analysisAreaName==='Drawn polygon');
 assert.deepEqual(await page.evaluate(()=>rainSelection.cells.map(({r,c})=>[r,c])),[[reference.r,reference.c]]);
 await page.selectOption('#analysisAreaMode','rectangle');await dragRectangleInMap(70,70,125,125);await applyArea();
 await page.waitForFunction(()=>analysisAreaName==='Drawn rectangle'&&rainAnalysis.gridCells===0);
 assert.match(await page.textContent('#analysisAreaMessage'),/No archived rainfall grid cells/);
 await page.click('#resetAnalysisArea');await page.selectOption('#rainChartStatistic','maximum');assert.equal(await page.evaluate(()=>analysisGeometry),null);
 await page.evaluate(view=>{map.setView(view.center,view.zoom,{animate:false});return true},originalDrawingView);
 await page.evaluate(()=>window.scrollTo(0,0));
 assert.ok(basinRequests>=1,'independent basin-toggle checks exercised lazy asset loading');assert.equal(await page.isChecked('#drainageBasins'),false);
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);
 async function chartCursorUtc(){return await page.evaluate(()=>{const line=[...$('rainChart').querySelectorAll('line')].find(el=>el.getAttribute('stroke')==='#fff');if(!line)return null;const t0=Date.parse(rainData.times[0].utc),t1=Date.parse(rainData.times.at(-1).utc),x=Number(line.getAttribute('x1'));return new Date(t0+(x-66)/(1100-66-78)*(t1-t0)).toISOString()})}
 async function nearestRainUtc(anchor){return await page.evaluate(anchor=>rainData.times.reduce((best,row)=>Math.abs(Date.parse(row.utc)-Date.parse(anchor))<Math.abs(Date.parse(best.utc)-Date.parse(anchor))?row:best).utc,anchor)}
 await page.locator('[name="productMode"][value="crest"]').check();await page.waitForFunction(()=>$('status').textContent.startsWith('CREST')&&data&&rainData);
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
 await page.locator('[name="productMode"][value="rainfall"]').check();assert.equal(await page.isChecked('#showCrest'),true);
 assert.equal(await page.locator('#rainChart path[stroke="#a0e28b"]').count()>0,true);
 await page.locator('[name="productMode"][value="crest"]').check();assert.equal(await page.isChecked('#showCrest'),true);
 await page.locator('[name="productMode"][value="rainfall"]').check();
 // Low-bin cells must leave the basemap exposed in every product/display mode.
 for(const product of ['rainfall','crest']){
  await page.locator(`[name="productMode"][value="${product}"]`).check();
  await page.waitForFunction(p=>$('product').value===p&&(p==='rainfall'?rainData:data),product);
  for(const mode of (product==='rainfall'?['cumulative','one_hour','three_hour']:['frame','ever'])){
   await page.selectOption(product==='rainfall'?'#rainMode':'#mode',mode);
   for(const index of ['0','3','max']){
    await page.locator('#time').evaluate((el,ix)=>{el.value=ix==='max'?el.max:ix;el.dispatchEvent(new Event('input',{bubbles:true}));},index);
    const result=await page.evaluate(()=>{
     const grid=currentGrid(),threshold=$('product').value==='rainfall'?0.1:200;
     const expected=grid.frame?grid.frame.flat().filter(v=>v!==null&&v>=threshold).length:0;
     const visible=layer.getLayers().filter(cell=>cell._productVisible);return {expected,actual:visible.length,gray:visible.filter(cell=>['#a1aab5','#434958'].includes(cell.options.fillColor)).length};
    });
    assert.equal(result.gray,0,product+' '+mode+' '+index+' contains gray product cells');
    assert.equal(result.actual,result.expected,product+' '+mode+' '+index+' lost meaningful colored cells');
    assert.ok(await page.evaluate(()=>layer.getLayers().filter(cell=>cell._productVisible).every(cell=>cell.options.fillOpacity===Number($('productOpacity').value)/100)),product+' opacity differs');
   }
  }
 }
 await page.locator('[name="productMode"][value="rainfall"]').check();await page.selectOption('#rainMode','cumulative');
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
 await page.locator('[name="productMode"][value="crest"]').check();await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 assert.equal(await page.locator('.drainage-basin-line').count(),n);await checkLabels(10);
 await page.selectOption('#mode','frame');
 await page.locator('#time').evaluate(el=>{el.value=3;el.dispatchEvent(new Event('input',{bubbles:true}))});
 assert.equal(await page.locator('.drainage-basin-line').count(),n);await checkLabels(10);
 await page.locator('#productOpacity').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});
 const styles=await page.locator('.drainage-basin-line').first().evaluate(el=>({opacity:el.getAttribute('stroke-opacity'),fill:el.getAttribute('fill')}));
 assert.equal(styles.opacity,'0.95');assert.equal(styles.fill,'none');
 await page.locator('[name="productMode"][value="rainfall"]').check();await page.selectOption('#rainMode','one_hour');
 const pearlRequestCount=basinRequests;
 await page.evaluate(()=>{map.setZoom(12,{animate:false});});await page.waitForFunction(()=>!map._animatingZoom);
 assert.equal(await page.locator('.drainage-basin-line').count(),n);
 assert.equal(basinRequests,pearlRequestCount);assert.ok(!basinAssetPaths.some(p=>p.endsWith('/huc12.geojson')));
 console.log('Pearl zoom 12 retains HUC10:',await page.textContent('#basinStatus'));await checkLabels(10);
 await page.locator('[name="productMode"][value="swipe"]').check();await page.selectOption('#analysisAreaMode','basin');
 const swipeBasin=await findGridBasinPoint();assert.ok(swipeBasin,'find basin interior beneath active swipe products');await page.mouse.click(swipeBasin.x,swipeBasin.y);
 await page.waitForFunction(huc=>analysisAreaName.includes('HUC10 '+huc),swipeBasin.huc);assert.equal(await page.evaluate(()=>analysisAreaType),'basin','HUC10 selection works while the product panes are clipped');
 await page.click('#resetAnalysisArea');await page.selectOption('#analysisAreaMode','basin');
 const swipeBasinAgain=await findGridBasinPoint(swipeBasin.huc);assert.ok(swipeBasinAgain,'reset leaves another HUC10 selectable in swipe mode');await page.mouse.click(swipeBasinAgain.x,swipeBasinAgain.y);
 await page.waitForFunction(huc=>analysisAreaName.includes('HUC10 '+huc),swipeBasinAgain.huc);await page.click('#resetAnalysisArea');
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
 await page.locator('[name="productMode"][value="crest"]').check();await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 await page.locator('#time').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.locator('[name="productMode"][value="rainfall"]').check();await page.waitForFunction(()=>$('status').textContent.includes('rainfall'));
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
 await page.locator('[name="productMode"][value="crest"]').check();await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
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
 await page.locator('[name="productMode"][value="rainfall"]').check();await page.locator('#productOpacity').evaluate(el=>{el.value=65;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.selectOption('#rainMode','cumulative');
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.screenshot({path:'work/jefferson-basins.png',fullPage:true});
 await page.selectOption('#eventSelect','2026-10-31_pearl-river-ms');await page.waitForFunction(()=>rainData&&activeEvent.id.includes('pearl')&&$('status').textContent.includes('rainfall'));
 await page.selectOption('#eventSelect','test-gap');await page.waitForFunction(()=>activeEvent.id==='test-gap'&&rainData&&data);
 assert.equal(await page.locator('[name="productMode"][value="swipe"]').isDisabled(),false);
 await page.locator('[name="productMode"][value="swipe"]').check();
 await page.evaluate(()=>window.scrollTo(0,0));
 const gapPin=await page.evaluate(()=>{const rect=$('map').getBoundingClientRect();for(let i=0;i<data.times.length;i++)for(let y=0;y<data.latitudes.length;y++)for(let x=0;x<data.longitudes.length;x++)if(data.frames[i]?.[y]?.[x]>=200){const point=map.latLngToContainerPoint([data.latitudes[y],data.longitudes[x]]);if(point.x>5&&point.y>5&&point.x<map.getSize().x-5&&point.y<map.getSize().y-5)return{index:activeTimes().findIndex(row=>Date.parse(row.utc)===Date.parse(data.times[i].utc)),lat:data.latitudes[y],lng:data.longitudes[x],x:rect.left+point.x,y:rect.top+point.y}}return null});
 assert.ok(gapPin&&gapPin.index>=0,'missing-frame fixture includes a valid CREST pin location');await page.locator('#time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('input',{bubbles:true}))},gapPin.index);await page.evaluate(()=>setSwipePosition(0));await page.mouse.click(gapPin.x,gapPin.y);
 await page.waitForFunction(()=>samples.length===1);assert.match(await page.locator('.pin-label').textContent(),/cfs\/mi²$/,'pin starts with the actual CREST sample at its location');
 const gapIndex=await page.evaluate(target=>activeTimes().findIndex(row=>Date.parse(row.utc)===Date.parse(target)),missingCrestUtc);assert.ok(gapIndex>=0);
 await page.locator('#time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('input',{bubbles:true}))},gapIndex);
 await page.waitForFunction(()=>$('archiveStatus').textContent.includes('CREST frame unavailable'));
 assert.equal(await page.textContent('#currentPeak'),'—','missing CREST timestamp remains unavailable');
 assert.equal(await page.locator('.pin-label').textContent(),'—','missing CREST frame clears the old pin value instead of keeping stale text');
 const selectedGap=await page.evaluate(()=>selectedUtc);await page.locator('[name="productMode"][value="crest"]').check();
 assert.ok(Math.abs(Date.parse(await page.evaluate(()=>selectedUtc))-Date.parse(selectedGap))<=600000,'switching product retains the nearest available archive time');
 await page.locator('[name="productMode"][value="swipe"]').check();
 await page.selectOption('#rainMode','three_hour');const rainGap=await page.evaluate(target=>activeTimes().findIndex(row=>Date.parse(row.utc)===Date.parse(target)),gapRainSource.times[4].utc);
 await page.locator('#time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('input',{bubbles:true}))},rainGap);
 await page.waitForFunction(()=>$('archiveStatus').textContent.includes('MRMS three hour frame unavailable'));
 assert.equal(await page.evaluate(()=>rainLayer.getLayers().length),0,'missing rainfall mode frame is not drawn as zero');
 await page.evaluate(()=>setSwipePosition(100));assert.equal(await page.locator('.pin-label').textContent(),'—','missing rainfall mode frame does not retain the previously visible CREST value');
 await page.selectOption('#eventSelect','2026-10-31_pearl-river-ms');await page.waitForFunction(()=>activeEvent.id.includes('pearl')&&rainData&&data);
 await page.selectOption('#eventSelect','test-rain-only');await page.waitForFunction(()=>activeEvent.id==='test-rain-only'&&rainData&&$('status').textContent.includes('rainfall'));
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);assert.equal(await page.isDisabled('#showCrest'),true);assert.match(await page.getAttribute('#showCrest','title'),/unavailable/i);
 assert.equal(await page.locator('[name="productMode"][value="crest"]').isDisabled(),true,'CREST-only mode is unavailable when the event has no CREST archive');
 assert.equal(await page.locator('[name="productMode"][value="swipe"]').isDisabled(),true,'swipe mode is unavailable when either archive is absent');
 let missingRainRequests=0;await page.route('**/data/no-such-event/rainfall.json',route=>{missingRainRequests++;return route.fulfill({status:404,body:'missing'})});
 await page.selectOption('#eventSelect','test-no-rain');await page.waitForFunction(()=>$('rainChartMessage').textContent.includes('unavailable'));
 assert.equal(await page.locator('#rainTimelinePanel').isVisible(),true);assert.equal(missingRainRequests,1);
 await page.selectOption('#eventSelect','test-rain-only');await page.waitForFunction(()=>activeEvent.id==='test-rain-only'&&rainData&&$('status').textContent.includes('rainfall'));
 const playbackStart=await page.evaluate(()=>selectedUtc);
 await page.click('#playPause');
 await page.waitForFunction(start=>selectedUtc!==start&&$('playPause').dataset.playing==='true',playbackStart,{timeout:3000});
 await page.click('#playPause');const pausedAt=await page.evaluate(()=>selectedUtc);await page.waitForTimeout(650);
 assert.equal(await page.evaluate(()=>selectedUtc),pausedAt,'pause stops the archive timer');
 assert.deepEqual(await page.locator('#playbackSpeed option').evaluateAll(options=>options.map(o=>o.value)),['0.5','1','2','4']);
 await page.selectOption('#playbackSpeed','4');await page.locator('#time').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.click('#playPause');await page.waitForFunction(()=>Number($('time').value)>=3,{timeout:2000});await page.click('#playPause');
 await page.click('#playPause');await page.locator('#time').focus();await page.keyboard.press('End');
 assert.equal(await page.locator('#playPause').getAttribute('data-playing'),'false','manual keyboard scrubbing pauses playback');
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.click('#playPause');await page.waitForFunction(()=>Number($('time').value)===0&&$('playPause').dataset.playing==='true',{timeout:3000});
 await page.uncheck('#playbackLoop');await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.click('#playPause');await page.waitForFunction(()=>$('playPause').dataset.playing==='false'&&$('playPause').textContent.includes('Play'),{timeout:3000});
 await page.check('#playbackLoop');await page.locator('#time').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});await page.click('#playPause');
 await page.selectOption('#eventSelect','test-no-rain');await page.waitForFunction(()=>activeEvent.id==='test-no-rain'&&$('rainChartMessage').textContent.includes('unavailable'));
 assert.equal(await page.locator('#playPause').getAttribute('data-playing'),'false','switching events pauses playback');
 await page.selectOption('#eventSelect','test-rain-only');await page.waitForFunction(()=>activeEvent.id==='test-rain-only'&&rainData&&$('status').textContent.includes('rainfall'));
 await page.uncheck('#drainageBasins');
 assert.equal(await page.locator('.drainage-basin-line').count(),0);
 // New page has no loaded asset cache: a static fetch failure must leave products usable.
 failAssets=true;await page.reload();await page.waitForFunction(()=>rainData&&$('status').textContent.includes('rainfall'));
 await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('unavailable'));
 assert.equal(await page.locator('.drainage-basin-line').count(),0);
 await page.locator('[name="productMode"][value="crest"]').check();await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 await page.selectOption('#mode','ever');await page.waitForFunction(()=>layer.getLayers().length>0);
 assert.deepEqual(errors,[]);console.log('Offline static failure isolated; product remains functional; no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
