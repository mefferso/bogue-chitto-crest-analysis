"""Historical NOAA MRMS FLASH CREST county-grid extraction for GitHub Pages."""
import csv, gzip, json, re, tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import boto3, cfgrib, numpy as np, requests
from botocore import UNSIGNED
from botocore.config import Config
from shapely.geometry import shape
from shapely import contains_xy

PRODUCT = "FLASH_CREST_MAXUNITSTREAMFLOW"
START = datetime(2026, 10, 31, 18, tzinfo=timezone.utc)
END = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
FACTOR = 35.31466672148859 / 0.3861021585424458
LIMITS = (600, 1000, 2000, 5000)
OUT = Path("data")
OUT.mkdir(exist_ok=True)

def discover(s3):
    keys = []
    # S3 layouts have differed over time; explicitly probe likely products/paths.
    prefixes = [
        f"CONUS/{PRODUCT}_00.00/20261031/",
        f"CONUS/{PRODUCT}_00.00/20261101/",
    ]
    for prefix in prefixes:
        print("Searching", prefix, flush=True)
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket="noaa-mrms-pds", Prefix=prefix
        ):
            for item in page.get("Contents", []):
                key = item["Key"]
                m = re.search(r"(2026\d{4})-(\d{6})\.grib2\.gz$", key)
                if not m: continue
                ts = datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                if START <= ts <= END:
                    keys.append((ts, key))
    if not keys:
        print("No matching CREST keys. Checking available NOAA S3 archive prefixes:", flush=True)
        for prefix in ("CONUS/", "CONUS/FLASH_", "CONUS/FLASH_CREST_"):
            try:
                response = s3.list_objects_v2(Bucket="noaa-mrms-pds", Prefix=prefix, Delimiter="/", MaxKeys=1000)
                names = [e["Prefix"] for e in response.get("CommonPrefixes", [])]
                samples = [e["Key"] for e in response.get("Contents", [])[:5]]
                print(json.dumps({"prefix":prefix,"subdirectories":names[:80],"sample_objects":samples,"truncated":response.get("IsTruncated",False)}), flush=True)
            except Exception as exc:
                print(f"Archive diagnostics failed for {prefix}: {exc}", flush=True)
    return sorted(set(keys))

county_geojson = requests.get(
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json",
    timeout=60
)
county_geojson.raise_for_status()
feature = next(f for f in county_geojson.json()["features"] if str(f.get("id")) == "28109")
county = shape(feature["geometry"])
s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))
keys = [("s3", ts, key) for ts, key in discover(s3)]
if not keys:
    # Iowa State's historical MRMS archive uses a different path and filename.
    # Retain source-specific provenance; never substitute another FLASH product.
    from html.parser import HTMLParser
    class ArchiveLinks(HTMLParser):
        def __init__(self):
            super().__init__()
            self.hrefs = []
        def handle_starttag(self, tag, attrs):
            if tag == "a":
                self.hrefs.extend(value for name, value in attrs if name == "href" and value)

    for day in ("2026/10/31", "2026/11/01"):
        base = f"https://mtarchive.geol.iastate.edu/{day}/mrms/ncep/FLASH/CREST_MAXUNITSTREAMFLOW/"
        print("Checking Iowa State historical archive:", base, flush=True)
        try:
            response = requests.get(base, timeout=60)
            response.raise_for_status()
            parser = ArchiveLinks()
            parser.feed(response.text)
            for href in parser.hrefs:
                filename = href.rsplit("/", 1)[-1]
                match = re.fullmatch(r"CREST_MAXUNITSTREAMFLOW_00\.00_(2026\d{4})-(\d{6})\.grib2\.gz", filename)
                if not match:
                    continue
                ts = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                if START <= ts <= END:
                    keys.append(("iem", ts, urljoin(base, href)))
        except requests.RequestException as exc:
            print(f"Iowa State directory unavailable: {exc}", flush=True)
if not keys:
    raise SystemExit("No exact-product CREST files found at NOAA S3 or Iowa State archive for the requested UTC interval. No analysis published.")
keys = sorted(set(keys), key=lambda entry: entry[1])
print("Found", len(keys), "source files", flush=True)
rows, frames, source_keys = [], [], []
mask = latcut = loncut = area = None
peak_value, peak_timestamp, peak_point = -np.inf, None, None
event_max = None
with tempfile.TemporaryDirectory() as temp:
    grib = Path(temp) / "sample.grib2"
    for i, (source, ts, key) in enumerate(keys):
        if source == "s3":
            compressed = s3.get_object(Bucket="noaa-mrms-pds", Key=key)["Body"].read()
        else:
            response = requests.get(key, timeout=120)
            response.raise_for_status()
            compressed = response.content
        grib.write_bytes(gzip.decompress(compressed))
        ds = cfgrib.open_dataset(str(grib), indexpath="")
        try:
            var = next(iter(ds.data_vars.values()))
            field = np.asarray(var.values, dtype=np.float64)
            lat = np.asarray(ds.latitude.values, dtype=float)
            lon = np.asarray(ds.longitude.values, dtype=float)
            if lat.ndim != 1 or lon.ndim != 1 or field.ndim != 2:
                raise ValueError(f"Unexpected grid: {lat.shape}, {lon.shape}, {field.shape}")
            lon = np.where(lon > 180, lon - 360, lon)
            if mask is None:
                minx, miny, maxx, maxy = county.bounds
                yi = np.where((lat >= miny-.03)&(lat <= maxy+.03))[0]
                xi = np.where((lon >= minx-.03)&(lon <= maxx+.03))[0]
                latcut, loncut = lat[yi], lon[xi]
                xx, yy = np.meshgrid(loncut, latcut)
                mask = contains_xy(county, xx, yy)
                dlat = abs(float(np.median(np.diff(lat))))
                dlon = abs(float(np.median(np.diff(lon))))
                radians = np.deg2rad(latcut)
                area_per_row = (6371.0088**2) * np.deg2rad(dlon) * (
                    np.sin(radians + np.deg2rad(dlat)/2)-
                    np.sin(radians - np.deg2rad(dlat)/2)
                ) / 2.589988110336
                area = np.broadcast_to(area_per_row[:,None], mask.shape)
                event_max = np.full(mask.shape, -np.inf)
            data = field[np.ix_(yi, xi)] * FACTOR
            valid = mask & np.isfinite(data) & (data >= 0)
            good = np.where(valid, data, -np.inf)
            maximum = float(good.max())
            if np.isfinite(maximum) and maximum > peak_value:
                peak_value, peak_timestamp = maximum, ts.isoformat()
                rr, cc = np.unravel_index(good.argmax(), good.shape)
                peak_point = [float(latcut[rr]), float(loncut[cc])]
            event_max = np.maximum(event_max, good)
            row = {"utc": ts.isoformat(), "max_cfs_mi2": round(maximum, 2) if np.isfinite(maximum) else None}
            for level in LIMITS:
                row[f"area_ge_{level}_sqmi"] = round(float(area[(good >= level)].sum()), 2)
            rows.append(row)
            # Compact nested raster; null means outside county or missing (not zero).
            frames.append([[round(float(v), 1) if np.isfinite(v) else None for v in line] for line in good])
            source_keys.append(f"{source}:{key}")
            if (i+1)%10 == 0: print("Processed", i+1, "/", len(keys), flush=True)
        finally:
            ds.close()

if not np.isfinite(peak_value):
    raise SystemExit("No valid nonnegative CREST data in the county for requested period.")
with (OUT/"timeseries.csv").open("w",newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys())
    w.writeheader(); w.writerows(rows)
ever = {str(l): round(float(area[event_max >= l].sum()), 2) for l in LIMITS}
summary = {
    "status":"processed-from-archive", "product": PRODUCT, "source":"NOAA MRMS public AWS S3 or Iowa State historical MRMS archive",
    "source_keys": source_keys,
    "units":"cfs/mi²", "grids_analyzed":len(rows),
    "first_utc":rows[0]["utc"], "last_utc":rows[-1]["utc"],
    "peak_cfs_mi2":round(peak_value, 2), "peak_time_utc":peak_timestamp,
    "peak_latlon":peak_point, "area_ever_sqmi":ever,
    "method":"Native m³/s/km² to cfs/mi²; county cell-center mask; latitude-adjusted approximate grid-cell area",
    "limitations":"Modeled CREST maximum unit streamflow, not observed discharge. Time gaps are not interpolated. County edge area approximate."
}
raster = {
    "summary":summary, "times":rows,
    "latitudes":latcut.tolist(), "longitudes":loncut.tolist(),
    "dlat":abs(float(np.median(np.diff(latcut)))),
    "dlon":abs(float(np.median(np.diff(loncut)))),
    "frames":frames,
    "ever_max":[[round(float(v),1) if np.isfinite(v) else None for v in line] for line in event_max]
}
(OUT/"dashboard.json").write_text(json.dumps(raster, separators=(",",":")))
(OUT/"summary.json").write_text(json.dumps(summary,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k!="source_keys"},indent=2))
