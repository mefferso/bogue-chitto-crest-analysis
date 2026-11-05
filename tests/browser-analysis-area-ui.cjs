const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=process.cwd();
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='area.test'){
   const name=decodeURIComponent(url.pathname.slice(1))||'index.html',file=path.join(root,name);
   if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
   return route.fulfill({path:file,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/json'});
  }
  if(url.pathname.endsWith('leaflet.js'))return route.fulfill({path:path.join(root,'work/leaflet.js'),contentType:'text/javascript'});
  if(url.pathname.endsWith('leaflet.css'))return route.fulfill({path:path.join(root,'work/leaflet.css'),contentType:'text/css'});
  return route.abort();
 });
 await page.goto('http://area.test/?event=2026-10-31_pearl-river-ms');
 await page.waitForFunction(()=>rainData&&data&&$('status').textContent.includes('rainfall'));
 assert.equal(await page.evaluate(()=>Number($('time').value)),0,'archive opens at its first rainfall frame');
 assert.equal(await page.evaluate(()=>selectedUtc),await page.evaluate(()=>rainData.times[0].utc));
 const cell=await page.evaluate(()=>{for(let r=0;r<rainData.latitudes.length;r++)for(let c=0;c<rainData.longitudes.length;c++)if(rainData.frames.cumulative.at(-1)?.[r]?.[c]!=null)return {lat:rainData.latitudes[r],lng:rainData.longitudes[c],dy:rainData.dlat*.45,dx:rainData.dlon*.45};});
 await page.selectOption('#analysisAreaMode','rectangle');
 const coords=await page.evaluate(cell=>{const box=$('map').getBoundingClientRect();return [[cell.lat-cell.dy,cell.lng-cell.dx],[cell.lat+cell.dy,cell.lng+cell.dx]].map(([lat,lng])=>{const p=map.latLngToContainerPoint([lat,lng]);return {x:box.left+p.x,y:box.top+p.y}})},cell);
 await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y,{steps:5});await page.mouse.up();
 assert.equal(await page.locator('#applyAreaDrawing').isVisible(),true,'rectangle drawing advances to review');
 assert.equal(await page.evaluate(()=>analysisGeometry),null,'draft rectangle does not replace the active analysis');
 await page.click('#applyAreaDrawing');await page.waitForFunction(()=>analysisAreaName==='Drawn rectangle');
 const applied=await page.evaluate(()=>JSON.stringify(analysisGeometry));assert.ok(await page.locator('.analysis-area-label').count()>0,'applied geometry has a label');
 await page.click('#editAnalysisArea');assert.equal(await page.locator('#cancelAreaChanges').isVisible(),true);
 await page.click('#cancelAreaChanges');assert.equal(await page.evaluate(()=>JSON.stringify(analysisGeometry)),applied,'canceling edit keeps applied geometry and stats');
 await page.selectOption('#analysisAreaMode','polygon');
 const polygon=await page.evaluate(cell=>{const y=cell.lat,x=cell.lng,dy=cell.dy,dx=cell.dx;return [[y-dy,x-dx],[y-dy,x+dx],[y+dy,x+dx],[y+dy,x-dx]]},cell);
 const sampleCount=await page.evaluate(()=>samples.length);
 await page.evaluate(points=>points.forEach(([lat,lng])=>map.fire('click',{latlng:L.latLng(lat,lng)})),polygon);
 assert.equal(await page.evaluate(()=>samples.length),sampleCount,'drawing clicks do not add map samples');
 await page.click('#finishAreaPolygon');assert.equal(await page.locator('#applyAreaDrawing').isVisible(),true,'polygon enters review before apply');
 await page.click('#applyAreaDrawing');await page.waitForFunction(()=>analysisAreaName==='Drawn polygon');
 assert.equal(await page.locator('#editAnalysisArea').isVisible(),true);
 await page.selectOption('#analysisAreaMode','polygon');
 assert.equal(await page.isDisabled('#undoAreaPoint'),true,'undo is disabled before a vertex exists');assert.equal(await page.locator('#areaDrawingToolbar').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#areaDrawingToolbar').isVisible(),false,'Escape cancels active drawing');
 await page.selectOption('#eventSelect','2026-10-31_jefferson-parish-la');
 await page.waitForFunction(()=>activeEvent.id.includes('jefferson')&&rainData&&data);
 assert.equal(await page.evaluate(()=>analysisGeometry),null,'changing event clears the active area');
 assert.equal(await page.evaluate(()=>Number($('time').value)),0,'new event starts at first rainfall frame');
 assert.deepEqual(errors,[]);console.log('analysis-area drawing UI checks passed');await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
