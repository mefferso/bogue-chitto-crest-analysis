/* Map-only drawing and editing controls for custom analysis areas. */
(function (root) {
 'use strict';
 function createAnalysisAreaDrawing({map,L,toolbar,message,sidebarMessage,finishButton,undoButton,cancelButton,applyButton,cancelChangesButton,removeVertexButton,validatePolygon,onApply,onCancel=()=>{},onDraftStart=()=>{}}) {
  const preview=L.layerGroup().addTo(map),shapePreview=L.layerGroup().addTo(map),container=map.getContainer();
  const paneName='analysisAreaDraft',handlePaneName='analysisAreaHandles';
  const draftPane=map.getPane(paneName)||map.createPane(paneName),handlePane=map.getPane(handlePaneName)||map.createPane(handlePaneName);
  draftPane.style.zIndex='480';handlePane.style.zIndex='490';
  let phase='idle',mode=null,points=[],cursor=null,editingExisting=false,selectedVertex=null,pointerId=null,rectangleStart=null;
  let previousDblClick=false,previousDragging=false,handlersAttached=false;
  const point=(lat,lng)=>L.latLng(lat,lng);
  const clone=latlng=>point(latlng.lat,latlng.lng);
  const geometryFromPoints=values=>{const ring=values.map(p=>[p.lng,p.lat]);if(ring.length)ring.push([...ring[0]]);return {type:'Polygon',coordinates:[ring]}};
  function setMessage(text,isError=false){message.textContent=text;if(sidebarMessage){sidebarMessage.textContent=text;sidebarMessage.classList.toggle('is-error',isError)}message.classList.toggle('is-error',isError)}
  function styleFor(error=false){return {pane:paneName,color:error?'#ff6b6b':'#ffd166',weight:3,opacity:1,fillColor:error?'#ff6b6b':'#ffd166',fillOpacity:.1,dashArray:'7 5',interactive:false}}
  function clearPreview(){preview.clearLayers();shapePreview.clearLayers()}
  function buttonState(){
   const drawing=phase==='drawing',review=phase==='review';toolbar.hidden=phase==='idle';
   finishButton.hidden=!(drawing&&mode==='polygon');undoButton.hidden=!(drawing&&mode==='polygon');
   cancelButton.hidden=!drawing;applyButton.hidden=!review;cancelChangesButton.hidden=!review;
   removeVertexButton.hidden=!(review&&mode==='polygon');
   undoButton.disabled=!points.length;removeVertexButton.disabled=selectedVertex===null||points.length<=3;
   if(review){const validation=validatePolygon(geometryFromPoints(points));applyButton.disabled=!validation.valid;}
  }
  function setCursor(active){
   container.classList.toggle('area-drawing-active',active);
   container.style.touchAction=active&&mode==='rectangle'&&phase==='drawing'?'none':'';
  }
  function attachDrawingHandlers(){
   if(handlersAttached)return;handlersAttached=true;
   previousDblClick=map.doubleClickZoom.enabled();if(previousDblClick)map.doubleClickZoom.disable();
   if(mode==='polygon')map.on('mousemove',onMapMove);
   if(mode==='rectangle'){
    container.addEventListener('pointerdown',onPointerDown,true);
    container.addEventListener('pointermove',onPointerMove,true);
    container.addEventListener('pointerup',onPointerUp,true);
    container.addEventListener('pointercancel',onPointerCancel,true);
   }
   document.addEventListener('keydown',onKeyDown,true);setCursor(true);
  }
  function detachDrawingHandlers(){
   if(!handlersAttached)return;handlersAttached=false;
   map.off('mousemove',onMapMove);
   container.removeEventListener('pointerdown',onPointerDown,true);
   container.removeEventListener('pointermove',onPointerMove,true);
   container.removeEventListener('pointerup',onPointerUp,true);
   container.removeEventListener('pointercancel',onPointerCancel,true);
   document.removeEventListener('keydown',onKeyDown,true);
   if(previousDblClick)map.doubleClickZoom.enable();
   if(previousDragging&&!map.dragging.enabled())map.dragging.enable();
   if(pointerId!==null&&container.hasPointerCapture?.(pointerId))container.releasePointerCapture(pointerId);
   pointerId=null;rectangleStart=null;setCursor(false);
  }
  function begin(nextPhase,nextMode,existing=false){
   finish(false);phase=nextPhase;mode=nextMode;editingExisting=existing;selectedVertex=null;
   previousDragging=map.dragging.enabled();
   attachDrawingHandlers();buttonState();onDraftStart({editingExisting:existing,mode});
  }
  function finish(notifyCancel=false){
   const hadDraft=phase!=='idle',wasEditing=editingExisting;
   detachDrawingHandlers();clearPreview();phase='idle';mode=null;points=[];cursor=null;editingExisting=false;selectedVertex=null;buttonState();
   if(notifyCancel&&hadDraft)onCancel({editingExisting:wasEditing});
  }
  function icon(className,glyph=''){
   return L.divIcon({className,html:glyph?'<span aria-hidden="true">'+glyph+'</span>':'<span aria-hidden="true"></span>',iconSize:[22,22],iconAnchor:[11,11]});
  }
  function addVertexMarker(latlng,index,draggable){
   const cls='area-drawing-vertex'+(index===0?' is-first':'')+(index===selectedVertex?' is-selected':'');
   const marker=L.marker(latlng,{pane:handlePaneName,icon:icon(cls,index===0?'●':''),interactive:draggable,draggable,keyboard:false,bubblingMouseEvents:false});
   marker.addTo(preview);
   if(draggable){
    marker.on('click',e=>{if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);selectedVertex=index;buttonState();renderReviewHandles()});
    marker.on('drag',e=>{
     if(mode==='rectangle')resizeRectangle(index,e.target.getLatLng());
     else points[index]=clone(e.target.getLatLng());
     renderReviewShape();updateValidationMessage();
    });
    marker.on('dragend',()=>renderReviewHandles());
   }
   return marker;
  }
  function addMidpoint(latlng,segmentIndex){
   const marker=L.marker(latlng,{pane:handlePaneName,icon:icon('area-drawing-midpoint','+'),interactive:true,keyboard:false,bubblingMouseEvents:false});
   marker.addTo(preview).on('click',e=>{
    if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);
    points.splice(segmentIndex+1,0,clone(latlng));
    if(mode==='rectangle')mode='polygon';
    selectedVertex=segmentIndex+1;renderReviewHandles();setMessage('Vertex inserted. Drag it into place, or select another vertex.');buttonState();
   });
  }
  function rectangleMidpoint(a,b){return point((a.lat+b.lat)/2,(a.lng+b.lng)/2)}
  function renderReviewShape(){
   shapePreview.clearLayers();
   if(points.length>=3)L.polygon(points,styleFor(!validatePolygon(geometryFromPoints(points)).valid)).addTo(shapePreview);
   else if(points.length>=2)L.polyline(points,styleFor()).addTo(shapePreview);
  }
  function renderReviewHandles(){
   preview.clearLayers();renderReviewShape();
   points.forEach((p,i)=>addVertexMarker(p,i,true));
   for(let i=0;i<points.length;i++)addMidpoint(rectangleMidpoint(points[i],points[(i+1)%points.length]),i);
   if(mode==='rectangle'&&points.length===4){
    const center=point((points[0].lat+points[2].lat)/2,(points[0].lng+points[2].lng)/2);
    const move=L.marker(center,{pane:handlePaneName,icon:icon('area-drawing-move','↔'),interactive:true,draggable:true,keyboard:false,bubblingMouseEvents:false,title:'Move rectangle'}).addTo(preview);
    let origin=center;
    move.on('drag',e=>{const next=e.target.getLatLng(),dLat=next.lat-origin.lat,dLng=next.lng-origin.lng;points=points.map(p=>point(p.lat+dLat,p.lng+dLng));origin=clone(next);renderReviewShape();updateValidationMessage()});
    move.on('dragend',renderReviewHandles);
   }
   buttonState();
  }
  function updateValidationMessage(){
   const result=validatePolygon(geometryFromPoints(points));
   if(!result.valid)setMessage(result.message,true);
   buttonState();
  }
  function renderDrawing(){
   clearPreview();
   if(points.length>=3)L.polygon(points,styleFor()).addTo(preview);
   if(points.length>=2)L.polyline(points,styleFor()).addTo(preview);
   if(points.length&&cursor)L.polyline([points[points.length-1],cursor],{pane:paneName,color:'#ffe08a',weight:2,dashArray:'4 6',opacity:.95,interactive:false}).addTo(preview);
   points.forEach((p,i)=>addVertexMarker(p,i,false));
  }
  function renderRectangle(){
   clearPreview();
   if(points.length===2){const bounds=L.latLngBounds(points[0],points[1]);L.rectangle(bounds,styleFor()).addTo(preview)}
  }
  function onMapMove(e){if(phase!=='drawing'||mode!=='polygon')return;cursor=clone(e.latlng);renderDrawing()}
  function nearFirst(latlng){
   if(points.length<3)return false;
   const a=map.latLngToContainerPoint(points[0]),b=map.latLngToContainerPoint(latlng);
   return a.distanceTo(b)<=14;
  }
  function mapClick(latlng){
   if(phase==='idle')return false;
   if(phase==='review'||mode==='rectangle')return true;
   if(nearFirst(latlng)){finishPolygon();return true}
   const next=clone(latlng),duplicate=points.some(existing=>map.latLngToContainerPoint(existing).distanceTo(map.latLngToContainerPoint(next))<7);
   if(duplicate){setMessage('That point duplicates an existing vertex; it was ignored.',true);return true}
   points.push(next);cursor=null;renderDrawing();setMessage(points.length+' vertices. Click the first point to close, or finish from the toolbar.');buttonState();return true;
  }
  function finishPolygon(){
   if(phase!=='drawing'||mode!=='polygon')return;
   if(points.length<3){setMessage('A polygon needs at least three distinct vertices.',true);return}
   const result=validatePolygon(geometryFromPoints(points));
   if(!result.valid){setMessage(result.message+' Adjust the points or use Undo Last Point.',true);return}
   phase='review';cursor=null;detachDrawingHandlers();renderReviewHandles();
   setMessage('Review the shape. Drag vertices, tap a + handle to insert a point, or remove a selected vertex. Analysis updates after Apply Analysis.');buttonState();
  }
  function rectanglePoints(a,b){
   const south=Math.min(a.lat,b.lat),north=Math.max(a.lat,b.lat),west=Math.min(a.lng,b.lng),east=Math.max(a.lng,b.lng);
   return [point(south,west),point(south,east),point(north,east),point(north,west)];
  }
  function resizeRectangle(index,latlng){
   const opposite=points[(index+2)%4];points=rectanglePoints(opposite,latlng);
  }
  function eventLatLng(e){const rect=container.getBoundingClientRect();return map.containerPointToLatLng(L.point(e.clientX-rect.left,e.clientY-rect.top))}
  function stopPointer(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.()}
  function onPointerDown(e){
   if(phase!=='drawing'||mode!=='rectangle'||e.button!==undefined&&e.button!==0||!e.isPrimary)return;
   stopPointer(e);pointerId=e.pointerId;container.setPointerCapture?.(pointerId);rectangleStart=eventLatLng(e);points=[rectangleStart,rectangleStart];
   if(previousDragging)map.dragging.disable();renderRectangle();setMessage('Drag to size the rectangle, then release to review it.');
  }
  function onPointerMove(e){if(phase!=='drawing'||mode!=='rectangle'||pointerId!==e.pointerId||!rectangleStart)return;stopPointer(e);points=[rectangleStart,eventLatLng(e)];renderRectangle()}
  function onPointerUp(e){
   if(phase!=='drawing'||mode!=='rectangle'||pointerId!==e.pointerId||!rectangleStart)return;
   stopPointer(e);points=[rectangleStart,eventLatLng(e)];pointerId=null;rectangleStart=null;
   if(previousDragging)map.dragging.enable();
   if(Math.abs(points[0].lat-points[1].lat)<1e-8||Math.abs(points[0].lng-points[1].lng)<1e-8){renderRectangle();setMessage('Drag across a non-zero area to make a rectangle.',true);return}
   points=rectanglePoints(points[0],points[1]);phase='review';detachDrawingHandlers();renderReviewHandles();setMessage('Review the rectangle. Drag a corner to resize or ↔ to reposition, then Apply Analysis.');buttonState();
  }
  function onPointerCancel(e){if(pointerId===e.pointerId){pointerId=null;rectangleStart=null;points=[];clearPreview();setMessage('Touch drawing was canceled. Drag to draw a rectangle, or cancel.');if(previousDragging)map.dragging.enable()}}
  function onKeyDown(e){
   if(phase!=='drawing'||e.altKey||e.ctrlKey||e.metaKey)return;
   const target=e.target,tag=target?.tagName?.toLowerCase();
   if(e.key==='Escape'){e.preventDefault();finish(true);return}
   if(['input','select','textarea','button'].includes(tag)||target?.isContentEditable)return;
   if(e.key==='Backspace'&&mode==='polygon'){e.preventDefault();undoPoint()}
  }
  function undoPoint(){
   if(phase!=='drawing'||mode!=='polygon')return;
   points.pop();cursor=null;renderDrawing();setMessage(points.length?points.length+' vertices remain.':'Choose points on the map to start a polygon.');buttonState();
  }
  function removeVertex(){
   if(phase!=='review'||selectedVertex===null)return;
   if(points.length<=3){setMessage('A polygon must keep at least three vertices.',true);return}
   points.splice(selectedVertex,1);selectedVertex=null;renderReviewHandles();updateValidationMessage();
  }
  function apply(){
   if(phase!=='review')return;
   const result=validatePolygon(geometryFromPoints(points));if(!result.valid){setMessage(result.message,true);buttonState();return}
   const geometry=geometryFromPoints(points),selectionType=mode;
   try{onApply(geometry,selectionType)}catch(error){setMessage('Could not apply this analysis area: '+error.message,true);return}
   finish(false);
  }
  function start(modeValue){
   if(!['polygon','rectangle'].includes(modeValue))return;
   begin('drawing',modeValue,false);points=[];cursor=null;renderDrawing();
   setMessage(modeValue==='polygon'?'Tap or click to add vertices. Close at the first point, or choose Finish Polygon.':'Drag on the map to draw a rectangle.');buttonState();
  }
  function edit(geometry,typeValue){
   const shape=geometry?.type==='Feature'?geometry.geometry:geometry;
   if(shape?.type!=='Polygon'||!Array.isArray(shape.coordinates?.[0])){setMessage('This analysis area cannot be edited as a single polygon.',true);return}
   const ring=shape.coordinates[0].slice();if(ring.length>1&&Math.abs(ring[0][0]-ring.at(-1)[0])<1e-10&&Math.abs(ring[0][1]-ring.at(-1)[1])<1e-10)ring.pop();
   begin('review',typeValue==='rectangle'?'rectangle':'polygon',true);points=ring.map(([lng,lat])=>point(lat,lng));renderReviewHandles();
   setMessage('Edit the draft shape. Changes to rainfall and CREST statistics wait until Apply Analysis.');
  }
  finishButton.addEventListener('click',finishPolygon);undoButton.addEventListener('click',undoPoint);cancelButton.addEventListener('click',()=>finish(true));
  applyButton.addEventListener('click',apply);cancelChangesButton.addEventListener('click',()=>finish(true));removeVertexButton.addEventListener('click',removeVertex);
  L.DomEvent.disableClickPropagation(toolbar);L.DomEvent.disableScrollPropagation(toolbar);
  return {start,edit,mapClick,cancel:()=>finish(true),reset:()=>finish(false),isActive:()=>phase!=='idle',state:()=>({phase,mode,points:points.map(p=>[p.lng,p.lat]),selectedVertex})};
 }
 root.createAnalysisAreaDrawing=createAnalysisAreaDrawing;
 if(typeof module!=='undefined'&&module.exports)module.exports=createAnalysisAreaDrawing;
})(typeof window!=='undefined'?window:globalThis);
