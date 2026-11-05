const assert=require('node:assert/strict');
const fs=require('node:fs');
const createAnalysis=require('../analysis-area.js');
const analysis=createAnalysis();
const square={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
const grid={latitudes:[0.5,1.5],longitudes:[0.5,1.5,2.5],dlat:1,dlon:1};
const selection=analysis.mask(grid,square);
assert.deepEqual(selection.cells.map(c=>[c.r,c.c]),[[0,0],[0,1],[1,0],[1,1]],'cell centers on/inside the polygon are selected');
assert.ok(selection.coverage>0&&selection.coverage<100,'coverage reports partial archived grid area');
assert.equal(analysis.mask(grid,square),selection,'geometry masks are cached per grid');
const rainfall={...grid,times:[{utc:'a'},{utc:'b'},{utc:'c'}],frames:{
 cumulative:[[[1,3,99],[5,7,99]],[[null,4,99],[6,8,99]],[[0,0,99],[0,0,99]]],
 one_hour:[[ [null,null,null],[null,null,null] ],[[2,4,99],[6,8,99]],[[null,null,null],[null,null,null]]],
 three_hour:[[[null,null,null],[null,null,null]],[[null,null,null],[null,null,null]],[[3,5,99],[7,9,99]]]
}};
const result=analysis.rainfall(rainfall,selection);
assert.equal(result.maxEvent.value,8);
assert.equal(result.max1.value,8);
assert.equal(result.max3.value,9);
assert.equal(result.series[0].max_1h,null,'missing 1-hour values stay missing');
assert.equal(result.series[0].max_3h,null,'baseline is not treated as a 3-hour observation');
assert.equal(result.series[1].validCells,3,'null cells are omitted from valid counts');
const earthRadius=6371008.8,toRadians=degrees=>degrees*Math.PI/180;
const independentArea=lat=>earthRadius**2*toRadians(grid.dlon)*(Math.sin(toRadians(lat+grid.dlat/2))-Math.sin(toRadians(lat-grid.dlat/2)));
const independentCells=[[0.5,1],[0.5,3],[1.5,5],[1.5,7]].map(([lat,value])=>({area:independentArea(lat),value}));
const expected=independentCells.reduce((s,c)=>s+c.value*c.area,0)/independentCells.reduce((s,c)=>s+c.area,0);
assert.ok(Math.abs(result.series[0].mean_cumulative-expected)<1e-10,'mean is independently area weighted');
const crest={...grid,longitudes:[0.5,2.5],times:[{utc:'a'}],frames:[[[200,999],[400,999]]]};
assert.equal(analysis.crest(crest,analysis.mask(crest,square))[0].max,400,'CREST uses its own grid coordinates with the shared geometry');
const partial={...rainfall,frames:{...rainfall.frames,cumulative:rainfall.frames.cumulative.map((frame,i)=>i===2?[[null,null,null],[null,null,null]]:frame)}};
const priorOnly={...rainfall,times:rainfall.times.slice(0,2),frames:{...rainfall.frames,cumulative:rainfall.frames.cumulative.slice(0,2)}};
assert.equal(analysis.rainfall(partial,selection).meanEvent,analysis.rainfall(priorOnly,selection).meanEvent,'event mean retains each cell’s latest valid cumulative observation when the final grid is missing');
assert.equal(analysis.summarize([[null]],{cells:[{r:0,c:0,area:1}]}).max,null,'empty selections do not invent zeros');
assert.equal(analysis.mask(grid,null).cells.length,6,'Entire Event selects the available grid footprint');
const archived=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/rainfall.json'),'utf8'));
const wholeEvent=analysis.rainfall(archived,analysis.mask(archived,null));
for(let i=1;i<archived.times.length;i++)for(const [computed,source] of [['max_cumulative','max_cumulative'],['max_1h','max_1h'],['max_3h','max_3h']])assert.equal(wholeEvent.series[i][computed],archived.times[i][source],`Entire Event ${computed} archive value at index ${i}`);
assert.equal(wholeEvent.series[0].max_1h,null,'original zero-accumulation baseline remains an invalid 1-hour observation');
assert.equal(wholeEvent.series[0].max_3h,null,'original zero-accumulation baseline remains an invalid 3-hour observation');
const validTriangle={type:'Polygon',coordinates:[[[0,0],[2,0],[1,2],[0,0]]]};
assert.equal(analysis.validatePolygon(validTriangle).valid,true,'a valid triangle is accepted');
assert.match(analysis.validatePolygon({type:'Polygon',coordinates:[[[0,0],[1,0],[0,0]]]}).message,/three distinct/i,'duplicate vertices do not count toward the minimum');
assert.match(analysis.validatePolygon({type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[0,0]]]}).message,/area|degenerate/i,'collinear rings are rejected');
assert.match(analysis.validatePolygon({type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}).message,/intersect/i,'self-intersecting rings are rejected');
console.log('analysis-area tests passed');
