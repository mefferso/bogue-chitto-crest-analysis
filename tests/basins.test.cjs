const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(fetcher){
 assert.ok(fs.existsSync('drainage-basins.js'),'overlay module must exist');
 const context={console,document:{createElement:()=>({textContent:''})},window:{},Map,fetch:fetcher};
 vm.runInNewContext(fs.readFileSync('drainage-basins.js','utf8'),context);
 const listeners={},layers=new Set();
 const map={zoom:10,createPane:()=>({style:{}}),getZoom(){return this.zoom},on(n,f){listeners[n]=f},addLayer(l){layers.add(l)},removeLayer(l){layers.delete(l)}};
 const toggle={checked:false,addEventListener(n,f){this.change=f}},status={textContent:''};
 const L={svg:()=>({}),geoJSON(data,options){return {data,options,addTo(m){m.addLayer(this);return this}}}};
 const controller=context.window.createDrainageBasins({map,L,toggle,status,fetcher});
 return {map,toggle,status,controller,listeners,layers};
}
const geo={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Pearl',huc:'1234567890'},geometry:{type:'Polygon',coordinates:[]}}]};
const manifest={events:{a:{status:'available',levels:{10:'a10',12:'a12'}},b:{status:'available',levels:{10:'b10',12:'b12'}}}};
const response=d=>({ok:true,json:async()=>d});
const tick=()=>new Promise(r=>setImmediate(r));
test('off by default; lazy fetch; zoom replaces resolution; off removes all',async()=>{
 const calls=[];const s=setup(async url=>{calls.push(url);return response(url.includes('index.json')?manifest:geo)});
 s.controller.setEvent({id:'a'}); await tick();assert.equal(calls.length,0);
 s.toggle.checked=true;await s.toggle.change();await tick();assert.equal(s.layers.size,1);assert.ok(s.status.textContent.includes('HUC10'));
 s.map.zoom=12;await s.listeners.zoomend();await tick();assert.equal(s.layers.size,1);assert.equal(calls.at(-1),'a12');
 s.toggle.checked=false;await s.toggle.change();assert.equal(s.layers.size,0);assert.equal(s.status.textContent,'Off');
});
test('late old-event response and disabled request never render',async()=>{
 let resolveOld;const s=setup(async url=>url==='a10'?new Promise(r=>resolveOld=r):response(url.includes('index.json')?manifest:geo));
 s.controller.setEvent({id:'a'});s.toggle.checked=true;s.toggle.change();await tick();
 s.controller.setEvent({id:'b'});await tick();assert.equal(s.layers.size,1);assert.ok(s.status.textContent.includes('HUC10'));
 resolveOld(response(geo));await tick();assert.equal(s.layers.size,1);
 s.toggle.checked=false;s.toggle.change();await tick();assert.equal(s.layers.size,0);
});
test('failed static fetch is isolated and retry works',async()=>{
 let failed=true;const s=setup(async url=>{if(failed)throw Error('offline');return response(url.includes('index.json')?manifest:geo)});
 s.controller.setEvent({id:'a'});s.toggle.checked=true;await s.toggle.change();await tick();assert.match(s.status.textContent,/unavailable/i);assert.equal(s.layers.size,0);
 failed=false;s.toggle.checked=false;s.toggle.change();s.toggle.checked=true;s.toggle.change();await tick();assert.equal(s.layers.size,1);
});
test('cached static assets work without a live GIS connection',async()=>{
 let offline=false;const s=setup(async url=>{if(offline)throw Error('offline');return response(url.includes('index.json')?manifest:geo)});
 s.controller.setEvent({id:'a'});s.toggle.checked=true;s.toggle.change();await tick();
 offline=true;s.toggle.checked=false;s.toggle.change();s.toggle.checked=true;s.toggle.change();await tick();assert.equal(s.layers.size,1);
});
test('popup uses text content; boundaries do not capture polygon interiors',async()=>{
 const s=setup(async url=>response(url.includes('index.json')?manifest:geo));
 s.controller.setEvent({id:'a'});s.toggle.checked=true;s.toggle.change();await tick();
 const layer=[...s.layers][0];assert.equal(layer.options.style.fill,false);assert.equal(layer.options.bubblingMouseEvents,false);
 let popup;layer.options.onEachFeature(geo.features[0],{bindPopup(p){popup=p}});assert.match(popup.textContent,/Pearl.*1234567890/);
});
