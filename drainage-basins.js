/* Independent geographic reference overlay. No rainfall/CREST state is mutated. */
(function () {
 'use strict';
 window.createDrainageBasins = function ({map, L, toggle, status, fetcher = fetch, onBasinClick = () => {}}) {
  const pane = map.createPane('drainageBasins');
  pane.style.zIndex = '450';
  const labelPane = map.createPane('basinLabels');
  labelPane.style.zIndex = '460';
  labelPane.style.pointerEvents = 'none';
  const renderer = L.svg({pane:'drainageBasins', padding:0.3});
  const cache = new Map();
  let manifestPromise = null, event = null, generation = 0, visible = null;
  let labels = [];
  function basinName(properties) {
   const name = String(properties.name ?? '').replace(/\s+/g,' ').trim();
   return !/\p{L}/u.test(name) || /^(unnamed\b|unknown$|null$|n\/?a$|none$)/i.test(name) ? String(properties.huc) : name;
  }
  function positionLabels() {
   if (!visible || !labels.length) return;
   const viewport = map.getContainer().getBoundingClientRect(), occupied = [];
   // Keep dataset order stable so labels do not flicker as the map moves.
   for (const {layer, level} of labels) {
    const element = layer.getTooltip()?.getElement();
    if (!element) continue;
    element.dataset.hucLevel = String(level);
    const rect = element.getBoundingClientRect();
    const inside = rect.left >= viewport.left+8 && rect.right <= viewport.right-8 && rect.top >= viewport.top+8 && rect.bottom <= viewport.bottom-24;
    const overlaps = occupied.some(box => rect.left < box.right+6 && rect.right > box.left-6 && rect.top < box.bottom+6 && rect.bottom > box.top-6);
    element.style.visibility = inside && !overlaps ? 'visible' : 'hidden';
    if (inside && !overlaps) occupied.push(rect);
   }
  }
  function hideLabels() {
   // Leaflet fades detached tooltips out; hide them immediately during a layer swap.
   for (const {layer} of labels) {
    const element = layer.getTooltip()?.getElement();
    if (element) element.style.visibility = 'hidden';
   }
  }
  function clear() {
   hideLabels();
   if (visible) map.removeLayer(visible);
   visible = null;
   labels = [];
  }
  async function read(url) {
   if (!cache.has(url)) {
    const pending = fetcher(url).then(response => {
     if (!response.ok) throw Error('Static basin asset unavailable');
     return response.json();
    }).catch(error => { cache.delete(url); throw error; });
    cache.set(url, pending);
   }
   return cache.get(url);
  }
  function manifest() {
   if (!manifestPromise) manifestPromise = read('data/basins/index.json').catch(error => {manifestPromise=null;throw error;});
   return manifestPromise;
  }
  async function update() {
   const request = ++generation;
   clear();
   if (!toggle.checked) {status.textContent='Off';return;}
   if (!event) {status.textContent='Select an event';return;}
   const id = event.id, level = map.getZoom() >= 11 ? 12 : 10;
   status.textContent='Loading USGS WBD HUC'+level+'…';
   try {
    const index = await manifest();
    if (request !== generation) return;
    const coverage = index.events?.[id];
    if (coverage?.status !== 'available' || !coverage.levels?.[level]) throw Error('No published coverage');
    const geo = await read(coverage.levels[level]);
    if (request !== generation) return;
    if (geo.type !== 'FeatureCollection' || !Array.isArray(geo.features) || !geo.features.length) throw Error('Invalid basin asset');
    visible = L.geoJSON(geo, {
     pane:'drainageBasins', renderer, bubblingMouseEvents:false,
     attribution:'<a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset">USGS Watershed Boundary Dataset</a>',
     style:{color:'#55d9ce', weight:1.6, opacity:0.95, fill:false, className:'drainage-basin-line'},
     onEachFeature(feature, layer) {
      const content = document.createElement('span');
      const name = basinName(feature.properties);
      content.textContent = name+' · HUC'+level+': '+feature.properties.huc;
      layer.bindPopup(content);
      if (layer.on) layer.on('click', () => onBasinClick(feature, name, level));
      const label = document.createElement('span');
      label.textContent = name;
      layer.bindTooltip(label, {permanent:true, direction:'center', pane:'basinLabels',
       className:'basin-name', opacity:1, interactive:false});
      labels.push({layer, level});
     }
    }).addTo(map);
    positionLabels();
    status.textContent='USGS WBD · HUC'+level+' · '+geo.features.length+' hydrologic units';
   } catch (error) {
    if (request !== generation) return;
    status.textContent='Drainage basins unavailable for this event. Toggle off/on to retry.';
    console.warn('Static USGS WBD overlay unavailable',error);
   }
  }
  toggle.addEventListener('change',update);
  map.on('zoomstart',hideLabels);
  map.on('zoomend',update);
  map.on('moveend',positionLabels);
  return {setEvent(next) {event=next;return update();}};
 };
})();
