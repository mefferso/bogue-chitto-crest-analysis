/* Cell-centred selection and area-weighted summaries for archived grids. */
(function (root) {
 'use strict';
 const EARTH_RADIUS_M = 6371008.8;
 const rad = degrees => degrees * Math.PI / 180;
 function geometryOf(value) { return value?.type === 'Feature' ? value.geometry : value; }
 function inRing(point, ring) {
  const [x,y]=point; let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const [xi,yi]=ring[i],[xj,yj]=ring[j];
   if(((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
 }
 function inPolygon(point, rings) {
  return !!rings?.length && inRing(point,rings[0]) && !rings.slice(1).some(r=>inRing(point,r));
 }
 function contains(geometry, lat, lon) {
  if(!geometry)return true;
  const point=[lon,lat], g=geometryOf(geometry);
  if(!g)return false;
  if(g.type==='Polygon')return inPolygon(point,g.coordinates);
  if(g.type==='MultiPolygon')return g.coordinates.some(poly=>inPolygon(point,poly));
  return false;
 }
 function boundsOf(geometry) {
  const g=geometryOf(geometry);if(!g)return null;let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  const visit=value=>{if(Array.isArray(value)&&typeof value[0]==='number'&&typeof value[1]==='number'){minLon=Math.min(minLon,value[0]);maxLon=Math.max(maxLon,value[0]);minLat=Math.min(minLat,value[1]);maxLat=Math.max(maxLat,value[1])}else if(Array.isArray(value))for(const child of value)visit(child)};
  visit(g.coordinates);return Number.isFinite(minLon)?{minLon,maxLon,minLat,maxLat}:null;
 }
 // Spherical area of GeoJSON rings. This is an approximation at regional scale.
 function ringArea(ring) {
  let total=0;
  for(let i=0;i<ring.length-1;i++){
   const [lon1,lat1]=ring[i],[lon2,lat2]=ring[i+1];
   let dlon=rad(lon2-lon1);
   if(dlon>Math.PI)dlon-=2*Math.PI; else if(dlon< -Math.PI)dlon+=2*Math.PI;
   total+=dlon*(2+Math.sin(rad(lat1))+Math.sin(rad(lat2)));
  }
  return Math.abs(total)*EARTH_RADIUS_M*EARTH_RADIUS_M/2;
 }
 function geometryArea(value) {
  const g=geometryOf(value); if(!g)return null;
  const polygonArea=rings=>Math.max(0,ringArea(rings[0])-rings.slice(1).reduce((s,r)=>s+ringArea(r),0));
  if(g.type==='Polygon')return polygonArea(g.coordinates);
  if(g.type==='MultiPolygon')return g.coordinates.reduce((s,p)=>s+polygonArea(p),0);
  return null;
 }
 function validatePolygon(value) {
  const geometry=geometryOf(value),ring=geometry?.type==='Polygon'?geometry.coordinates?.[0]:null;
  const invalid=message=>({valid:false,message});
  if(!Array.isArray(ring))return invalid('Draw a polygon to continue.');
  if(ring.some(point=>!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1])))return invalid('Polygon coordinates must be finite map locations.');
  const points=ring.slice();
  const same=(a,b)=>Math.abs(a[0]-b[0])<=1e-10&&Math.abs(a[1]-b[1])<=1e-10;
  if(points.length>1&&same(points[0],points.at(-1)))points.pop();
  if(points.length<3||new Set(points.map(point=>point.map(v=>v.toFixed(10)).join(','))).size<3)return invalid('A polygon needs at least three distinct vertices.');
  for(let i=0;i<points.length;i++)if(same(points[i],points[(i+1)%points.length]))return invalid('Consecutive polygon vertices must be distinct.');
  let twiceArea=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length];twiceArea+=a[0]*b[1]-b[0]*a[1];
   minX=Math.min(minX,a[0]);maxX=Math.max(maxX,a[0]);minY=Math.min(minY,a[1]);maxY=Math.max(maxY,a[1]);
  }
  const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const onSegment=(a,b,p)=>Math.min(a[0],b[0])-1e-10<=p[0]&&p[0]<=Math.max(a[0],b[0])+1e-10&&Math.min(a[1],b[1])-1e-10<=p[1]&&p[1]<=Math.max(a[1],b[1])+1e-10;
  const intersects=(a,b,c,d)=>{
   const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b),eps=1e-12;
   if((o1>eps&&o2< -eps||o1< -eps&&o2>eps)&&(o3>eps&&o4< -eps||o3< -eps&&o4>eps))return true;
   return Math.abs(o1)<=eps&&onSegment(a,b,c)||Math.abs(o2)<=eps&&onSegment(a,b,d)||Math.abs(o3)<=eps&&onSegment(c,d,a)||Math.abs(o4)<=eps&&onSegment(c,d,b);
  };
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;
   if(intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))return invalid('The polygon edges cross or touch. Move a vertex to remove the self-intersection.');
  }
  if(Math.abs(twiceArea)<=Math.max(1,(maxX-minX)*(maxY-minY))*1e-12)return invalid('The polygon has zero area; move its vertices to enclose an area.');
  return {valid:true,message:''};
 }
 function cellArea(grid,lat) {
  const height=rad(Math.abs(grid.dlat)), width=rad(Math.abs(grid.dlon));
  return EARTH_RADIUS_M*EARTH_RADIUS_M*width*Math.abs(Math.sin(rad(lat)+height/2)-Math.sin(rad(lat)-height/2));
 }
 function createAnalysis() {
  const cache=new WeakMap();
  function mask(grid,geometry) {
   if(!grid||!Array.isArray(grid.latitudes)||!Array.isArray(grid.longitudes))return {cells:[],geometryArea:geometryArea(geometry),gridArea:0,coverage:0};
   let byGrid=cache.get(grid);if(!byGrid){byGrid=new Map();cache.set(grid,byGrid)}
   const key=geometry?JSON.stringify(geometryOf(geometry)):'__entire_event__';
   if(byGrid.has(key))return byGrid.get(key);
   const cells=[];let gridArea=0;const bounds=geometry?boundsOf(geometry):null;
   for(let r=0;r<grid.latitudes.length;r++)for(let c=0;c<grid.longitudes.length;c++){
    const lat=grid.latitudes[r],lon=grid.longitudes[c];
    if((!bounds||(lat>=bounds.minLat&&lat<=bounds.maxLat&&lon>=bounds.minLon&&lon<=bounds.maxLon))&&contains(geometry,lat,lon)){const area=cellArea(grid,lat);cells.push({r,c,area});gridArea+=area}
   }
   const wholeArea=geometryArea(geometry),coverage=geometry?Math.min(100,gridArea/wholeArea*100):100;
   const value={cells,geometryArea:wholeArea,gridArea,coverage};byGrid.set(key,value);return value;
  }
  function summarize(frame,selection) {
   let max=null,sum=0,weight=0,count=0;
   if(frame)for(const {r,c,area} of selection.cells){
    const value=frame[r]?.[c];if(value==null||!Number.isFinite(value))continue;
    if(max===null||value>max)max=value;sum+=value*area;weight+=area;count++;
   }
   return {max,mean:weight?sum/weight:null,validCells:count};
  }
  function rainfall(data,selection) {
   const series=data.times.map((row,i)=>{
    const cumulative=summarize(data.frames.cumulative?.[i],selection);
    const oneHour=summarize(data.frames.one_hour?.[i],selection);
    const threeHour=summarize(data.frames.three_hour?.[i],selection);
    return {utc:row.utc,max_cumulative:cumulative.max,mean_cumulative:cumulative.mean,
     max_1h:oneHour.max,mean_1h:oneHour.mean,max_3h:threeHour.max,mean_3h:threeHour.mean,
     validCells:cumulative.validCells,validCells_1h:oneHour.validCells,validCells_3h:threeHour.validCells};
   });
   const maximum=field=>{let best=null;for(let i=0;i<series.length;i++){const v=series[i][field];if(v!=null&&Number.isFinite(v)&&(best===null||v>best.value))best={value:v,index:i,utc:series[i].utc}}return best};
   // Event mean uses the last valid cumulative value per selected cell, so a
   // missing final grid does not silently discard earlier archived rainfall.
   const eventFrame=selection.cells.map(cell=>{
    let value=null;
    for(const frame of data.frames.cumulative||[]){const next=frame?.[cell.r]?.[cell.c];if(next!=null&&Number.isFinite(next))value=next}
    return value;
   });
   let eventSum=0,eventWeight=0;
   selection.cells.forEach((cell,i)=>{const value=eventFrame[i];if(value!=null){eventSum+=value*cell.area;eventWeight+=cell.area}});
   return {series,maxEvent:maximum('max_cumulative'),max1:maximum('max_1h'),max3:maximum('max_3h'),meanEvent:eventWeight?eventSum/eventWeight:null,coverage:selection.coverage,
    gridCells:selection.cells.length,selection};
  }
  function crest(data,selection) {
   if(!data?.frames)return null;
   return data.times.map((row,i)=>({utc:row.utc,...summarize(data.frames[i],selection)}));
  }
  return {mask,rainfall,crest,summarize,geometryArea,contains,validatePolygon};
 }
 root.createRainfallAreaAnalysis=createAnalysis;
 if(typeof module!=='undefined'&&module.exports)module.exports=createAnalysis;
})(typeof window!=='undefined'?window:globalThis);
