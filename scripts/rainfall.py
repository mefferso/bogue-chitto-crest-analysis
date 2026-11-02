"""Independent historical hourly MRMS MultiSensor QPE Pass 2 extraction."""
import gzip,json,re,tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
import boto3,numpy as np,requests,xarray as xr
from botocore import UNSIGNED
from botocore.config import Config
from shapely.geometry import shape
from shapely import contains_xy
START=datetime(2026,10,31,18,tzinfo=timezone.utc)
END=datetime(2026,11,1,12,tzinfo=timezone.utc)
PRODUCT="MultiSensor_QPE_01H_Pass2"
BUCKET="noaa-mrms-pds"
def main():
    s3=boto3.client("s3",config=Config(signature_version=UNSIGNED))
    found={}
    for day in (START.date(),END.date()):
        prefix=f"CONUS/{PRODUCT}_00.00/{day:%Y%m%d}/"
        print("Searching",prefix,flush=True)
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET,Prefix=prefix):
            for obj in page.get("Contents",[]):
                key=obj["Key"]
                m=re.search(r"(\d{8})-(\d{6})\.grib2\.gz$",key)
                if m:
                    ts=datetime.strptime("".join(m.groups()),"%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    if START<ts<=END and ts.minute==ts.second==0:found[ts]=key
    expected=[START+timedelta(hours=i) for i in range(1,int((END-START).total_seconds()/3600)+1)]
    missing=[t.isoformat() for t in expected if t not in found]
    if missing:raise SystemExit(f"Missing hourly QPE intervals: {missing}; refusing incomplete event accumulation")
    response=requests.get("https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json",timeout=60)
    response.raise_for_status()
    county=shape(next(f for f in response.json()["features"] if str(f.get("id"))=="28109")["geometry"])
    latcut=loncut=mask=yi=xi=original_shape=None
    hourly=[]
    with tempfile.TemporaryDirectory() as temp:
        grib=Path(temp)/"qpe.grib2"
        for ts in expected:
            key=found[ts]
            grib.write_bytes(gzip.decompress(s3.get_object(Bucket=BUCKET,Key=key)["Body"].read()))
            with xr.open_dataset(grib,engine="cfgrib",backend_kwargs={"indexpath":""}) as ds:
                field=np.asarray(next(iter(ds.data_vars.values())).values,dtype=float)
                lat=np.asarray(ds.latitude.values,dtype=float)
                lon=np.asarray(ds.longitude.values,dtype=float)
                lon=np.where(lon>180,lon-360,lon)
                if field.ndim!=2 or lat.ndim!=1 or lon.ndim!=1:raise ValueError("Unexpected MRMS grid dimensionality")
                if mask is None:
                    minx,miny,maxx,maxy=county.bounds
                    yi=np.where((lat>=miny-.03)&(lat<=maxy+.03))[0]
                    xi=np.where((lon>=minx-.03)&(lon<=maxx+.03))[0]
                    if not len(yi) or not len(xi):raise ValueError("No grid cells in county bounds")
                    latcut=lat[yi];loncut=lon[xi]
                    xx,yy=np.meshgrid(loncut,latcut)
                    mask=contains_xy(county,xx,yy)
                    if not mask.any():raise ValueError("Empty county mask")
                elif field.shape!=original_shape or not np.allclose(lat[yi],latcut) or not np.allclose(lon[xi],loncut):
                    raise ValueError("Grid geometry changed during event")
                original_shape=field.shape
                v=field[np.ix_(yi,xi)]
                v=np.where(mask & np.isfinite(v) & (v>=0),v/25.4,np.nan)
                if np.isnan(v[mask]).any():raise ValueError(f"Missing county QPE values at {ts}")
                hourly.append(v)
            print("Decoded",ts.isoformat(),flush=True)
    cube=np.stack(hourly)
    cum=np.cumsum(cube,axis=0)
    rolling3=[None if i<2 else cube[i-2:i+1].sum(axis=0) for i in range(len(cube))]
    def mx(a):return None if a is None else round(float(np.max(a[mask])),3)
    def encode(a):
        return None if a is None else [[round(float(v),3) if np.isfinite(v) else None for v in line] for line in a]
    rows=[{"utc":t.isoformat(),"max_1h":mx(cube[i]),"max_3h":mx(rolling3[i]),
           "max_cumulative":mx(cum[i]),"source_key":found[t]} for i,t in enumerate(expected)]
    # The initial timestamp is a zero-accumulation baseline, not a 1-hour QPE observation.
    baseline=np.where(mask,0.0,np.nan)
    rows.insert(0,{"utc":START.isoformat(),"max_1h":None,"max_3h":None,
                   "max_cumulative":0.0,"source_key":None})
    p1=max(rows,key=lambda r:r["max_1h"])
    p3=max((r for r in rows if r["max_3h"] is not None),key=lambda r:r["max_3h"])
    result={"summary":{"product":PRODUCT,"source":"NOAA public MRMS AWS archive","units":"inches",
                       "start_utc":START.isoformat(),"end_utc":END.isoformat(),"hourly_grids":len(expected),
                       "max_event_inches":mx(cum[-1]),"peak_1h_inches":p1["max_1h"],"peak_1h_utc":p1["utc"],
                       "peak_3h_inches":p3["max_3h"],"peak_3h_utc":p3["utc"],
                       "limitations":"18Z Oct 31 to 12Z Nov 1, matching CREST temporal boundaries. First map frame is a zero accumulation baseline, not a 1-hour observation. Pass 2 QPE estimates, hourly ending times; county maxima need not share location."},
            "latitudes":latcut.tolist(),"longitudes":loncut.tolist(),
            "dlat":abs(float(np.median(np.diff(latcut)))),"dlon":abs(float(np.median(np.diff(loncut)))),
            "times":rows,"frames":{"cumulative":[encode(baseline)]+[encode(a) for a in cum],
                                   "one_hour":[None]+[encode(a) for a in cube],
                                   "three_hour":[None]+[encode(a) for a in rolling3]}}
    out=Path("data/rainfall.json");out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result,separators=(",",":")))
    print("Wrote",out,"rain max",result["summary"]["max_event_inches"],flush=True)
if __name__=="__main__":main()
