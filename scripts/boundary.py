"""Explicit county/parish and adjacent NWS coastal-marine analysis geometries.

Marine-inclusive maps represent a combined analysis area, not county totals.
The exact boundaries used are archived per event for reproducibility.
"""
import json
import requests
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

COUNTY_SOURCE="https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
MARINE_SOURCE="https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/5/query"
NWS_COUNTY_SOURCE="https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/2/query"

def generate(fips, destination, marine=False, neighbors=False):
    r=requests.get(COUNTY_SOURCE,timeout=65);r.raise_for_status()
    features=r.json()["features"]
    county_feature=next((f for f in features if str(f.get("id"))==fips),None)
    if county_feature is None:raise ValueError("Unknown county FIPS "+fips)
    old_county=shape(county_feature["geometry"])
    if old_county.is_empty or not old_county.is_valid:raise ValueError("Reference county geometry invalid")
    minx,miny,maxx,maxy=old_county.bounds
    county_params={"where":"1=1","geometry":f"{minx-0.02},{miny-0.02},{maxx+0.02},{maxy+0.02}",
        "geometryType":"esriGeometryEnvelope","inSR":4326,"outSR":4326,
        "spatialRel":"esriSpatialRelIntersects","outFields":"*","returnGeometry":"true","f":"geojson"}
    county_response=requests.get(NWS_COUNTY_SOURCE,params=county_params,timeout=80)
    county_response.raise_for_status()
    county_payload=county_response.json()
    if "error" in county_payload:raise ValueError("NWS county query failed: "+str(county_payload["error"]))
    candidates=[shape(f["geometry"]) for f in county_payload.get("features",[]) if f.get("geometry")]
    candidates=[g for g in candidates if not g.is_empty and g.is_valid]
    if not candidates:raise ValueError("NWS county boundary query returned no valid geometry")
    county=max(candidates,key=lambda g:g.intersection(old_county).area/max(g.union(old_county).area,1e-12))
    overlap=county.intersection(old_county).area/max(county.union(old_county).area,1e-12)
    if overlap<0.45:raise ValueError(f"NWS county polygon does not match FIPS reference (intersection/union={overlap:.2f})")

    surrounding=[]
    result=county
    if neighbors:
        # Detect shared boundaries, not counties merely inside a rectangular search.
        from shapely.geometry import box
        search=box(*old_county.buffer(0.35).bounds)
        for feat in features:
            fid=str(feat.get("id"))
            if fid==fips:continue
            geom=shape(feat["geometry"])
            if geom.is_empty or not geom.is_valid or not geom.intersects(search):continue
            overlap_boundary=old_county.boundary.intersection(geom.buffer(0.005)).length
            if overlap_boundary<=0.025:continue
            surrounding.append({"fips":fid,"geometry":geom})
        if not surrounding:raise ValueError("No neighboring counties found; check county geometry")
        result=unary_union([county]+[entry["geometry"] for entry in surrounding])
    chosen=[]
    if marine:
        minx,miny,maxx,maxy=county.bounds
        params={"where":"1=1","geometry":f"{minx-0.04},{miny-0.04},{maxx+0.04},{maxy+0.04}",
                "geometryType":"esriGeometryEnvelope","inSR":4326,"outSR":4326,
                "spatialRel":"esriSpatialRelIntersects","outFields":"*","returnGeometry":"true",
                "f":"geojson"}
        response=requests.get(MARINE_SOURCE,params=params,timeout=80)
        response.raise_for_status()
        payload=response.json()
        if "error" in payload:raise ValueError("NWS marine layer query failed: "+str(payload["error"]))
        zones=payload.get("features")
        if not isinstance(zones,list):raise ValueError("NWS marine layer returned no features collection")
        adjacent=county.buffer(0.015)
        for feat in zones:
            geom=shape(feat["geometry"])
            if geom.is_empty or not geom.intersects(adjacent):continue
            props=feat.get("properties",{})
            normalized={str(k).upper():v for k,v in props.items()}
            name=str(normalized.get("NAME") or "Unnamed")
            code=str(normalized.get("ID") or "")
            chosen.append({"id":code,"name":name,"geometry":geom})
        if not chosen:
            raise ValueError("No adjacent coastal marine zones returned; refusing silent county-only fallback")
        result=unary_union([result]+[z["geometry"] for z in chosen])
        if not result.is_valid:result=result.buffer(0)
        if result.is_empty:raise ValueError("Combined county/marine geometry empty")
    record={"type":"Feature","properties":{"fips":fips,"mode":"county_and_neighbors_and_marine" if marine and neighbors else "county_and_marine" if marine else "county_and_neighbors" if neighbors else "county",
            "surrounding_counties":[x["fips"] for x in surrounding],
            "marine_zones":[{"id":z["id"],"name":z["name"]} for z in chosen],
            "county_source":NWS_COUNTY_SOURCE,"county_reference_fips":COUNTY_SOURCE,"marine_source":MARINE_SOURCE if marine else None},
            "geometry":mapping(result)}
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(record,separators=(",",":")))
    return record

def load(directory,fips):
    path=Path(directory)/"boundary.geojson"
    if path.exists():
        doc=json.loads(path.read_text())
        if doc["properties"]["fips"]!=fips:raise ValueError("Cached event boundary FIPS mismatch")
        return shape(doc["geometry"])
    # Preserve direct use of legacy standalone processing scripts.
    r=requests.get(COUNTY_SOURCE,timeout=65);r.raise_for_status()
    return shape(next(f for f in r.json()["features"] if str(f.get("id"))==fips)["geometry"])
