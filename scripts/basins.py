"""Prepare static USGS WBD reference overlays without touching scientific archives.

Select full HUC geometries by intersection with archived land footprints. ArcGIS
object-ID batching avoids result offsets and service record-limit truncation.
"""
import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from shapely import make_valid
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

SOURCE = 'https://hydro-wfs.nationalmap.gov/arcgis/rest/services/wbd/FeatureServer'
COUNTIES = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json'
LAYERS = {10: 5, 12: 6}
TOLERANCE = 0.0001  # about 11 m latitude; topology preserved, WGS84 degrees
VERSION = 1
SESSION = requests.Session()
SESSION.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429,500,502,503,504])))


def get_json(url, params=None):
    response = SESSION.get(url, params=params, timeout=(15, 120))
    response.raise_for_status()
    data = response.json()
    if 'error' in data:
        raise ValueError(f'GIS service error: {data["error"]}')
    return data


def polygon(geometry):
    if not geometry:
        raise ValueError('Missing polygon geometry')
    geom = shape(geometry)
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.geom_type == 'GeometryCollection':
        geom = unary_union([g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
    if geom.is_empty or not geom.is_valid or geom.geom_type not in ('Polygon','MultiPolygon'):
        raise ValueError('Invalid or empty polygon geometry')
    if not (-180 <= geom.bounds[0] <= geom.bounds[2] <= 180 and -90 <= geom.bounds[1] <= geom.bounds[3] <= 90):
        raise ValueError('Geometry must be WGS84 longitude/latitude')
    return geom


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n')
    temporary.replace(path)


def load_counties(root, refresh=False):
    path = root / 'data/basins/counties.geojson'
    if refresh or not path.exists():
        data = get_json(COUNTIES)
        # Cache only counties referenced by events rather than a nationwide browser asset.
        return {str(f['id']).zfill(5): polygon(f['geometry']) for f in data['features']}
    data = json.loads(path.read_text())
    return {str(f['id']): polygon(f['geometry']) for f in data['features']}


def land_footprint(event, root, counties):
    boundary_path = event.get('boundary_file')
    doc = json.loads((root / boundary_path).read_text()) if boundary_path else None
    props = doc.get('properties', {}) if doc else {}
    # New boundaries archive the exact pre-marine union separately.
    land_path = event.get('land_boundary_file') or props.get('land_boundary_file')
    if not land_path and boundary_path:
        candidate = Path(boundary_path).with_name('land-boundary.geojson')
        if (root / candidate).exists():
            land_path = str(candidate)
    if land_path:
        land_doc = json.loads((root / land_path).read_text())
        return polygon(land_doc['geometry'])
    marine = bool(props.get('marine_zones') or event.get('marine_zones') or 'marine' in str(props.get('mode',event.get('boundary_mode',''))))
    if doc and not marine:
        return polygon(doc['geometry'])
    fips = str(props.get('fips') or event.get('fips') or '')
    if not fips and event.get('id') == '2026-10-31_pearl-river-ms':
        fips = '28109'
    if not re.fullmatch(r'\d{5}', fips):
        raise ValueError('Missing county FIPS for land-only watershed selection')
    codes = [fips] + list(props.get('surrounding_counties',event.get('surrounding_counties',[])))
    try:
        return unary_union([counties[str(code)] for code in codes])
    except KeyError as error:
        raise ValueError(f'County land geometry missing for FIPS {error.args[0]}') from error


def query_features(layer, land, batch_size=100):
    url = f'{SOURCE}/{layer}/query'
    ids = get_json(url, {'f':'json','where':'1=1','geometry':','.join(map(str,land.bounds)),
        'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects',
        'returnIdsOnly':'true'})
    if not isinstance(ids.get('objectIds'),list):
        raise ValueError('WBD query returned no object ID list')
    object_ids = sorted(set(ids['objectIds']))
    object_field = ids.get('objectIdFieldName','OBJECTID').lower()
    features = []
    for start in range(0,len(object_ids),batch_size):
        batch = object_ids[start:start+batch_size]
        data = get_json(url, {'f':'geojson','objectIds':','.join(map(str,batch)),
            'outFields':'*','outSR':4326,'returnGeometry':'true'})
        rows = data.get('features',[])
        returned = {str(next((v for k,v in f.get('properties',{}).items() if k.lower()==object_field),None)) for f in rows}
        if data.get('exceededTransferLimit') or returned != {str(i) for i in batch} or len(rows)!=len(batch):
            if len(batch)==1:
                raise ValueError('WBD response incomplete, refusing partial coverage')
            # Smaller batches honor a service limit lower than our conservative default.
            if batch_size<=2:
                raise ValueError('WBD response incomplete, refusing partial coverage')
            return query_features(layer,land,max(1,batch_size//2))
        features.extend(rows)
    return features


def select_features(features, land, level):
    selected = {}
    for feature in features:
        geom = polygon(feature.get('geometry'))
        if not geom.intersects(land):
            continue
        props = {k.lower(): v for k,v in feature.get('properties',{}).items()}
        huc = str(props.get(f'huc{level}',''))
        if not re.fullmatch(r'\d{' + str(level) + '}',huc):
            raise ValueError(f'Invalid HUC{level} identifier: {huc}')
        simplified = geom.simplify(TOLERANCE,preserve_topology=True)
        selected[huc] = {'type':'Feature','properties':{'huc':huc,'name':str(props.get('name') or 'Unnamed hydrologic unit'),'level':level},
                         'geometry':mapping(simplified)}
    if not selected:
        raise ValueError(f'No HUC{level} watersheds intersect the event land footprint')
    return [selected[key] for key in sorted(selected)]


def prepare(root, event_id=None, refresh=False):
    root = Path(root)
    out = root / 'data/basins'
    index_path = out / 'index.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {'version':VERSION,'events':{}}
    events = json.loads((root/'data/events.json').read_text())['events']
    if event_id and not any(e['id']==event_id for e in events):
        raise ValueError('Unknown event: '+event_id)
    counties = None
    county_error = None
    # Only fetch county reference data if a legacy or marine-inclusive event needs it.
    for event in events:
        if event_id and event['id'] != event_id:
            continue
        old = index['events'].get(event['id'],{})
        try:
            try:
                land = land_footprint(event,root,{})
            except ValueError:
                if counties is None:
                    if county_error:
                        raise ValueError(county_error)
                    try:
                        counties = load_counties(root,refresh)
                    except Exception as error:
                        county_error = str(error)
                        raise
                land = land_footprint(event,root,counties)
            fingerprint = hashlib.sha256((land.wkb_hex+f':{VERSION}:{TOLERANCE}').encode()).hexdigest()[:20]
            prefix = f'data/basins/{fingerprint}'
            levels = {str(level):f'{prefix}/huc{level}.geojson' for level in LAYERS}
            if refresh or not all((root/path).exists() for path in levels.values()):
                timestamp = datetime.now(timezone.utc).isoformat()
                prepared = {}
                for level, layer in LAYERS.items():
                    rows = select_features(query_features(layer,land),land,level)
                    metadata = get_json(f'{SOURCE}/{layer}',{'f':'json'})
                    prepared[levels[str(level)]] = {'type':'FeatureCollection','features':rows,'metadata':{
                        'source':SOURCE,'layer':layer,'huc_level':level,'retrieved_utc':timestamp,
                        'service_layer_name':metadata.get('name'),'service_editing_info':metadata.get('editingInfo'),
                        'crs':'EPSG:4326','simplification_degrees':TOLERANCE,'selection':'Full hydrologic units intersecting event land footprint',
                        'land_sha256':fingerprint,'land_bounds':list(land.bounds)}}
                # Publish only after both resolutions have been retrieved and validated.
                for path, data in prepared.items():
                    write_json(root/path,data)
            index['events'][event['id']] = {'status':'available','levels':levels,'land_bounds':list(land.bounds)}
        except Exception as error:
            print(f'Basins unavailable for {event["id"]}: {error}',file=sys.stderr)
            if old.get('status')=='available' and all((root/p).exists() for p in old.get('levels',{}).values()):
                index['events'][event['id']] = {**old,'last_refresh_error':str(error)}
            else:
                index['events'][event['id']] = {'status':'unavailable','reason':'Official WBD data could not be prepared','detail':str(error)}
    if counties:
        # Persist just the needed county reference polygons for offline future reuse.
        needed = set()
        for event in events:
            props = {}
            if event.get('boundary_file'):
                props = json.loads((root/event['boundary_file']).read_text()).get('properties',{})
            fips = props.get('fips') or event.get('fips') or ('28109' if event['id']=='2026-10-31_pearl-river-ms' else None)
            if fips: needed.add(str(fips))
            needed.update(map(str,props.get('surrounding_counties',event.get('surrounding_counties',[]))))
        write_json(out/'counties.geojson',{'type':'FeatureCollection','metadata':{'source':COUNTIES,'retrieved_utc':datetime.now(timezone.utc).isoformat()},
            'features':[{'type':'Feature','id':code,'properties':{'fips':code},'geometry':mapping(counties[code])} for code in sorted(needed) if code in counties]})
    index['source'] = SOURCE
    write_json(index_path,index)
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--event',help='Only prepare one registered event')
    parser.add_argument('--refresh',action='store_true',help='Refresh official source rather than reusing cached geography')
    parser.add_argument('--require-available',action='store_true',help='Fail validation if selected events lack static assets')
    args = parser.parse_args()
    result = prepare(args.root,args.event,args.refresh)
    selected = [v for k,v in result['events'].items() if not args.event or k==args.event]
    if args.require_available and any(v['status']!='available' or v.get('last_refresh_error') for v in selected):
        sys.exit('Some official basin assets could not be prepared; existing product archives remain intact.')
