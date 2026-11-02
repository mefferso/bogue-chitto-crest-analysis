"""Historical NOAA MRMS FLASH CREST county-grid extraction for GitHub Pages."""
import csv, gzip, json, re, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
import boto3, numpy as np, requests, xarray as xr
from botocore import UNSIGNED
from botocore.config import Config
from shapely.geometry import shape
from shapely import contains_xy
from boundary import load as load_boundary

PRODUCT = "FLASH_CREST_MAXUNITSTREAMFLOW"

FACTOR = 35.31466672148859 / 0.3861021585424458
LIMITS = (600, 1000, 2000, 5000)
import os
from datetime import timedelta
START = datetime.fromisoformat(os.environ.get("EVENT_START_UTC", "2026-10-31T18:00:00+00:00").replace("Z","+00:00")).astimezone(timezone.utc)
END = datetime.fromisoformat(os.environ.get("EVENT_END_UTC", "2026-11-01T12:00:00+00:00").replace("Z","+00:00")).astimezone(timezone.utc)
FIPS = os.environ.get("EVENT_FIPS", "28109")
OUT = Path(os.environ.get("EVENT_OUTPUT_DIR", "data"))
OUT.mkdir(parents=True, exist_ok=True)
if END <= START or END-START > timedelta(hours=72): raise ValueError("Event duration must be between 0 and 72 hours")


def discover(s3):
    keys = []
    # S3 layouts have differed over time; explicitly probe likely products/paths.
    prefixes = [f"CONUS/{PRODUCT}_00.00/{day:%Y%m%d}/" for day in
                (START.date() + timedelta(days=i) for i in range((END.date()-START.date()).days+1))]
    for prefix in prefixes:
        print("Searching", prefix, flush=True)
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket="noaa-mrms-pds", Prefix=prefix
        ):
            for item in page.get("Contents", []):
                key = item["Key"]
                m = re.search(r"(\d{8})-(\d{6})\.grib2\.gz$", key)
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

county = load_boundary(OUT, FIPS)
s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))
keys = discover(s3)
if not keys:
    raise SystemExit("No archived CREST keys at documented product/date prefixes. Review archive diagnostics above: the historical bucket may not store FLASH CREST; do not publish fabricated data.")
print("Found", len(keys), "source files", flush=True)
rows, frames, source_keys = [], [], []
mask = latcut = loncut = area = None
peak_value, peak_timestamp, peak_point = -np.inf, None, None
event_max = None
with tempfile.TemporaryDirectory() as temp:
    grib = Path(temp) / "sample.grib2"
    for i, (ts, key) in enumerate(keys):
        grib.write_bytes(gzip.decompress(s3.get_object(Bucket="noaa-mrms-pds", Key=key)["Body"].read()))
        ds = xr.open_dataset(str(grib), engine="cfgrib", backend_kwargs={"indexpath": ""})
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
            if field.shape != (len(lat),len(lon)) or not np.allclose(lat[yi],latcut) or not np.allclose(lon[xi],loncut):
                raise ValueError(f"CREST grid geometry changed at {ts}")
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
            source_keys.append(key)
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
    "status":"verified-from-archive", "product": PRODUCT, "source":"NOAA MRMS public AWS S3",
    "source_bucket":"noaa-mrms-pds", "source_keys": source_keys,
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
