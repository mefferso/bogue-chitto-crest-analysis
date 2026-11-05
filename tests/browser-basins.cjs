const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=process.cwd();
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let failAssets=false;let basinRequests=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='basins.test'){
   const name=decodeURIComponent(url.pathname.slice(1))||'index.html';
   if(name.startsWith('data/basins/')){basinRequests++;if(failAssets)return route.fulfill({status:503,body:'Offline test'});}
   const file=path.join(root,name);
   if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
   return route.fulfill({path:file,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/json'});
  }
  if(url.pathname.endsWith('leaflet.js'))return route.fulfill({path:path.join(root,'work/leaflet.js'),contentType:'text/javascript'});
  if(url.pathname.endsWith('leaflet.css'))return route.fulfill({path:path.join(root,'work/leaflet.css'),contentType:'text/css'});
  return route.abort();
 });
 await page.goto('http://basins.test/?event=2026-10-31_pearl-river-ms');
 await page.waitForFunction(()=>rainData && document.querySelector('#status').textContent.includes('rainfall'));
 assert.equal(basinRequests,0);assert.equal(await page.isChecked('#drainageBasins'),false);
 const before=await page.evaluate(()=>({product:$('product').value,time:$('time').value,zoom:map.getZoom(),center:map.getCenter(),current:$('rainCurrent').textContent}));
 const t=Date.now();await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('hydrologic units'));
 const after=await page.evaluate(()=>({product:$('product').value,time:$('time').value,zoom:map.getZoom(),center:map.getCenter(),current:$('rainCurrent').textContent}));
 assert.deepEqual(after,before);console.log('Pearl toggle preserves product/time/zoom/statistics; load ms',Date.now()-t);
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 console.log('Pearl regional:',await page.textContent('#basinStatus'));
 const n=await page.locator('.drainage-basin-line').count();assert.ok(n>0);
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 assert.equal(await page.locator('.drainage-basin-line').count(),n);
 await page.selectOption('#mode','frame');
 await page.locator('#time').evaluate(el=>{el.value=3;el.dispatchEvent(new Event('input',{bubbles:true}))});
 assert.equal(await page.locator('.drainage-basin-line').count(),n);
 await page.locator('#productOpacity').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))});
 const styles=await page.locator('.drainage-basin-line').first().evaluate(el=>({opacity:el.getAttribute('stroke-opacity'),fill:el.getAttribute('fill')}));
 assert.equal(styles.opacity,'0.95');assert.equal(styles.fill,'none');
 await page.selectOption('#product','rainfall');await page.selectOption('#rainMode','one_hour');
 await page.evaluate(()=>{map.setZoom(12,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC12 ·'));
 assert.ok(await page.locator('.drainage-basin-line').count()>n);
 console.log('Pearl zoom:',await page.textContent('#basinStatus'));
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 const target=await page.evaluate(()=>{
  const pane=map.getPane('drainageBasins');const mapRect=$('map').getBoundingClientRect();
  for(const el of pane.querySelectorAll('path')){
   const length=el.getTotalLength();for(let d=0;d<length;d+=Math.max(1,length/1000)){
    const p=el.getPointAtLength(d),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());
    if(q.x>mapRect.left+30&&q.x<mapRect.right-30&&q.y>mapRect.top+30&&q.y<mapRect.bottom-30)return {x:q.x,y:q.y};
   }
  }return null;
 });assert.ok(target);await page.mouse.click(target.x,target.y);await page.waitForSelector('.leaflet-popup-content');
 assert.match(await page.textContent('.leaflet-popup-content'),/HUC10: \d{10}/);assert.equal(await page.textContent('#pinCount'),'0 pins');
 console.log('Real SVG outline click popup:',await page.textContent('.leaflet-popup-content'));
 // Select a complete rainfall frame before testing sampling (early one-hour frames may be null).
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 // Pin sampling still works through transparent interiors; map's ordinary click handler is unchanged.
 await page.evaluate(()=>{const grid=currentGrid();outer:for(let r=0;r<grid.frame.length;r++)for(let c=0;c<grid.frame[r].length;c++)if(grid.frame[r][c]!==null){map.fire('click',{latlng:L.latLng(grid.dataset.latitudes[r],grid.dataset.longitudes[c])});break outer;}});
 assert.equal(await page.textContent('#pinCount'),'1 pin');
 await page.uncheck('#drainageBasins');assert.equal(await page.locator('.drainage-basin-line').count(),0);
 failAssets=true;await page.check('#drainageBasins');await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));assert.ok(await page.locator('.drainage-basin-line').count()>0);failAssets=false;
 await page.selectOption('#eventSelect','2026-10-31_jefferson-parish-la');
 await page.waitForFunction(()=>activeEvent.id.includes('jefferson')&&rainData&&$('status').textContent.includes('rainfall'));
 await page.waitForFunction(()=>$('basinStatus').textContent.includes('hydrologic units'));
 assert.equal(await page.isChecked('#drainageBasins'),true);
 await page.evaluate(()=>{map.setZoom(10,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC10 ·'));
 console.log('Jefferson + six neighbors:',await page.textContent('#basinStatus'));
 const jn=await page.locator('.drainage-basin-line').count();
 await page.selectOption('#product','crest');await page.waitForFunction(()=>$('status').textContent.startsWith('CREST'));
 assert.equal(await page.locator('.drainage-basin-line').count(),jn);
 await page.evaluate(()=>{map.setZoom(12,{animate:false});});await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC12 ·'));
 console.log('Jefferson zoom:',await page.textContent('#basinStatus'));
 await page.selectOption('#product','rainfall');await page.locator('#productOpacity').evaluate(el=>{el.value=65;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.selectOption('#rainMode','cumulative');
 await page.locator('#time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
 await page.screenshot({path:'work/jefferson-basins.png',fullPage:true});
 await page.selectOption('#eventSelect','2026-10-31_pearl-river-ms');await page.waitForFunction(()=>rainData&&activeEvent.id.includes('pearl')&&$('status').textContent.includes('rainfall'));
 await page.waitForFunction(()=>$('basinStatus').textContent.includes('HUC12 ·'));await page.uncheck('#drainageBasins');
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
