"""Validate GitHub Actions event parameters and maintain an immutable-by-default event registry."""
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path("data")
INDEX=ROOT/"events.json"
LEGACY={"id":"2026-10-31_pearl-river-ms","label":"Oct 31, 2026 — Pearl River County, MS",
"name":"Pearl River County, MS","start_utc":"2026-10-31T18:00:00Z",
"end_utc":"2026-11-01T12:00:00Z","data_dir":"data","products":{"crest":True,"rainfall":True}}
CENTRAL=ZoneInfo("America/Chicago")

def read_index():
    if not INDEX.exists(): return {"events":[LEGACY]}
    index=json.loads(INDEX.read_text())
    if not isinstance(index.get("events"),list): raise ValueError("Invalid event index")
    if not any(e.get("id")==LEGACY["id"] for e in index["events"]):index["events"].insert(0,LEGACY)
    return index

def parse_local(s):
    if not re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:00",s):
        raise ValueError("Specify YYYY-MM-DD HH:00 in Central time")
    naive=datetime.strptime(s,"%Y-%m-%d %H:%M")
    dt=naive.replace(tzinfo=CENTRAL)
    if dt.astimezone(timezone.utc).astimezone(CENTRAL).replace(tzinfo=None)!=naive:
        raise ValueError("Local time does not exist due to DST transition")
    if dt.replace(fold=0).utcoffset()!=dt.replace(fold=1).utcoffset():
        raise ValueError("Ambiguous Central fall-back hour; choose another hour")
    return dt.astimezone(timezone.utc)

def prepare():
    county=os.environ["EVENT_COUNTY"]
    match=re.fullmatch(r"(\d{5}) \| (.+), (LA|MS)",county)
    if not match:raise ValueError("Invalid county choice")
    fips,name,state=match.groups()
    start=parse_local(os.environ["EVENT_START_LOCAL"])
    end=parse_local(os.environ["EVENT_END_LOCAL"])
    hours=(end-start).total_seconds()/3600
    if not 0<hours<=72 or hours!=int(hours): raise ValueError("Duration must be 1–72 complete hours")
    slug=re.sub(r"[^a-z0-9]+","-",name.lower()).strip("-")
    eid=f"{start.astimezone(CENTRAL):%Y-%m-%d}_{slug}-{state.lower()}"
    out=ROOT/"events"/eid
    existing=any(e["id"]==eid for e in read_index()["events"]) or out.exists()
    if existing and os.environ.get("EVENT_OVERWRITE","false").lower()!="true":
        raise ValueError("Event already exists: use overwrite=true explicitly")
    out.mkdir(parents=True,exist_ok=True)
    from boundary import generate
    marine=os.environ.get("EVENT_INCLUDE_MARINE","false").lower()=="true"
    neighbors=os.environ.get("EVENT_INCLUDE_NEIGHBORS","false").lower()=="true"
    geometry=generate(fips,out/"boundary.geojson",marine=marine,neighbors=neighbors)
    print(f"Boundary created: {geometry['properties']['mode']}; zones: {geometry['properties']['marine_zones']}",file=sys.stderr)
    env={"EVENT_FIPS":fips,"EVENT_ID":eid,"EVENT_NAME":f"{name}, {state}",
         "EVENT_START_UTC":start.isoformat(),"EVENT_END_UTC":end.isoformat(),
         "EVENT_OUTPUT_DIR":str(out)}
    for k,v in env.items():
        print(f"{k}={v}")
    print(f"Prepared {eid}: {hours:.0f} hours",file=sys.stderr)

def register():
    out=Path(os.environ["EVENT_OUTPUT_DIR"])
    rainfall=out/"rainfall.json"
    if not rainfall.exists():raise ValueError("Rainfall file missing; not registering event")
    rain=json.loads(rainfall.read_text())
    if rain["summary"]["start_utc"]!=os.environ["EVENT_START_UTC"]:
        raise ValueError("Rainfall time coverage mismatch")
    crest_ok=os.environ.get("CREST_STATUS")=="success" and (out/"dashboard.json").exists()
    if not crest_ok:
        for filename in ("dashboard.json","summary.json","timeseries.csv"):
            (out/filename).unlink(missing_ok=True)
    name=os.environ["EVENT_NAME"]
    start=datetime.fromisoformat(os.environ["EVENT_START_UTC"]).astimezone(CENTRAL)
    end=datetime.fromisoformat(os.environ["EVENT_END_UTC"]).astimezone(CENTRAL)
    boundary=json.loads((out/"boundary.geojson").read_text())
    marine=bool(boundary["properties"]["marine_zones"])
    neighbors=bool(boundary["properties"].get("surrounding_counties"))
    area_name=name+(" + surrounding parishes/counties" if neighbors else "")+(" + adjacent NWS marine zones" if marine else "")
    event={"id":os.environ["EVENT_ID"],"name":area_name,
           "boundary_file":str(out/"boundary.geojson"),
           "boundary_mode":boundary["properties"]["mode"],
           "marine_zones":boundary["properties"]["marine_zones"],
           "surrounding_counties":boundary["properties"].get("surrounding_counties",[]),
           "label":f"{start:%b %-d, %Y} — {name}",
           "start_utc":os.environ["EVENT_START_UTC"],
           "end_utc":os.environ["EVENT_END_UTC"],
           "data_dir":str(out),
           "products":{"rainfall":True,"crest":crest_ok},
           "status":{"crest":"available" if crest_ok else "archive unavailable"}}
    (out/"event.json").write_text(json.dumps(event,indent=2)+"\n")
    index=read_index()
    index["events"]=[e for e in index["events"] if e["id"]!=event["id"]]+[event]
    index["events"].sort(key=lambda e:(e["start_utc"],e["name"]),reverse=True)
    INDEX.write_text(json.dumps(index,indent=2)+"\n")
    print("Registered",event["id"],"CREST:",crest_ok)

if __name__=="__main__":
    {"prepare":prepare,"register":register}[sys.argv[1]]()
