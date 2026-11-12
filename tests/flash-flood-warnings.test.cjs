const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','flash-flood-warnings.js'),'utf8');

const features=[
 {type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{ps:'FF.W',issue:'2026-10-31T18:00:00Z',expire:'2026-10-31T18:20:00Z',wfo:'LIX'}},
 {type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{ps:'FF.W',issue:'2026-10-31T18:20:00Z',expire:'2026-10-31T19:00:00Z',wfo:'LIX'}},
 {type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{ps:'TO.W',issue:'2026-10-31T18:00:00Z',expire:'2026-10-31T19:00:00Z'}}
];
async function tick(){await new Promise(resolve=>setImmediate(resolve))}
async function main(){
 const requests=[],layers=[];
 const mockL={
  geoJSON:()=>{
   const layer={features:[],addTo(){return this},clearLayers(){this.features=[];return this},addData(data){this.features.push(...data.features);return this}};
   layers.push(layer);return layer;
  }
 };
 const listeners={};
 const toggle={checked:true,addEventListener(event,callback){listeners[event]=callback}};
 const status={textContent:''};
 const context={window:{},document:{createElement(){return {textContent:'',append(){}}}},URL,AbortController,Date,console,fetch(url,opts){
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b});
  requests.push({url,opts,resolve,reject});
  return promise;
 }};
 vm.runInNewContext(source,context);
 const {createFlashFloodWarnings,__flashFloodWarningInternals:helpers}=context.window;
 assert.equal(helpers.parseUtc('202610311820'),Date.parse('2026-10-31T18:20:00Z'));
 assert.equal(helpers.parseUtc('2026-10-31 18:20:00'),Date.parse('2026-10-31T18:20:00Z'));
 const event={start_utc:'2026-10-31T18:00:00Z',end_utc:'2026-10-31T20:00:00Z'};
 const overlay=createFlashFloodWarnings({map:{createPane(){},getPane(){return {style:{}}}},L:mockL,toggle,status});
 overlay.reset(event);
 overlay.setTime('2026-10-31T18:00:00Z');
 assert.equal(requests.length,1,'one bulk archive request at event selection');
 assert.match(requests[0].url,/sts=2026-10-31T18/);
 assert.match(requests[0].url,/ets=2026-10-31T20/);
 requests[0].resolve({ok:true,json:async()=>({features})});await tick();await tick();
 assert.equal(layers[0].features.length,1,'first polygon starts at issuance');
 overlay.setTime('2026-10-31T18:19:59Z');
 assert.equal(layers[0].features.length,1);
 overlay.setTime('2026-10-31T18:20:00Z');
 assert.equal(layers[0].features.length,1,'next polygon replaces expired polygon');
 assert.equal(layers[0].features[0].properties.issue,'2026-10-31T18:20:00Z');
 overlay.setTime('2026-10-31T19:00:00Z');
 assert.equal(layers[0].features.length,0,'expiration is exclusive');
 assert.equal(requests.length,1,'scrubbing never triggers network requests');
 toggle.checked=false;listeners.change();assert.equal(layers[0].features.length,0);
 toggle.checked=true;listeners.change();assert.equal(requests.length,1,'toggle reuses event memory');
 overlay.setTime('2026-10-31T18:05:00Z');assert.equal(layers[0].features.length,1);
 overlay.reset(event);const stale=requests[1];
 overlay.reset(event);assert.equal(stale.opts.signal.aborted,true,'changing events aborts stale request');
 requests[2].resolve({ok:true,json:async()=>({features:[]})});await tick();await tick();
 assert.equal(layers[0].features.length,0,'empty archive produces no polygons');
 console.log('Flash Flood Warning event preload and playback tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});
