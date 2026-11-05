/* Independent geographic reference overlay. No rainfall/CREST state is mutated. */
(function () {
 'use strict';
 window.createDrainageBasins = function ({map, L, toggle, status, fetcher = fetch}) {
  const pane = map.createPane('drainageBasins');
  pane.style.zIndex = '450';
  const renderer = L.svg({pane:'drainageBasins', padding:0.3});
  const cache = new Map();
  let manifestPromise = null, event = null, generation = 0, visible = null;
  function clear() {
   if (visible) map.removeLayer(visible);
   visible = null;
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
      content.textContent = (feature.properties.name || 'Hydrologic unit')+' · HUC'+level+': '+feature.properties.huc;
      layer.bindPopup(content);
     }
    }).addTo(map);
    status.textContent='USGS WBD · HUC'+level+' · '+geo.features.length+' hydrologic units';
   } catch (error) {
    if (request !== generation) return;
    status.textContent='Drainage basins unavailable for this event. Toggle off/on to retry.';
    console.warn('Static USGS WBD overlay unavailable',error);
   }
  }
  toggle.addEventListener('change',update);
  map.on('zoomend',update);
  return {setEvent(next) {event=next;return update();}};
 };
})();
