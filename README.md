# Bogue Chitto / Pearl River County FLASH-CREST case study

**31 October 2026 — Research-only retrospective, not operational flood guidance.**

Interactive dashboard: https://mefferso.github.io/bogue-chitto-crest-analysis/

Displays NOAA MRMS FLASH CREST maximum unit streamflow (modeled, **not observed discharge**) in **cfs/mi²**, with a time slider, event-maximum grid, per-time peak, and counts/estimated square-mile footprints above 600, 1,000, 2,000 and 5,000 cfs/mi².

### Current status
The site is designed to show **no verified data** until the download/analysis workflow successfully retrieves and processes historical NOAA GRIB2. The AWIPS screenshot reported approximately 5,918 cfs/mi²; this is a **user-reported AWIPS value, not a verified archival maximum**.

### Run
GitHub Actions → **Retrieve October 31 CREST** → **Run workflow**. The action reads anonymous NOAA MRMS S3, writes generated dashboard JSON in `data/`, and commits results. GitHub Pages must be configured under Settings → Pages → Deploy from a branch → main /(root) if not already enabled. The action will fail loudly if data are absent or the archive layout differs.

Manual run: `pip install -r requirements.txt && python scripts/process.py`.

### Method
- Target: Pearl River County, Mississippi (FIPS 28109).
- Window: Oct 31 2026 18:00 UTC through Nov 1 2026 12:00 UTC (inclusive); timestamps are explicitly UTC, displayed in Central time on the dashboard.
- Native MRMS unit: m³ s⁻¹ km⁻², conversion to cfs/mi² = (35.31466672148859 / 0.3861021585424458).
- Keep only valid finite nonnegative grid values, clipped by **cell-center inside county**.
- Area estimates use latitude-adjusted spherical grid-cell areas. At county edges, counted area is approximate (not exact polygon/grid intersections).
- `area_at_time`: simultaneous area at each timestamp. `area_ever`: union of cells exceeding threshold at any available time; **not** simultaneous.
- These outputs are model predictions, not evidence of actual streamflow or damage; no flooding severity conclusions should be drawn from an isolated pixel.
- Dataset coverage, missing timestamps, provenance/source keys, and original raw files should be independently checked before publications.

Uses Leaflet + OpenStreetMap (external tile/CDN services); Python dependencies are pinned loosely for portability.


## Historical event library
Run **Actions → Generate Historical Event → Run workflow**. Choose a county/parish and enter Central local start and end as `YYYY-MM-DD HH:00`. Maximum event length is 72 hours. Ambiguous fall-back DST hours are rejected so timestamps are never silently misidentified. Events are stored under `data/events/<date>_<county>/` and indexed in `data/events.json`. The original 2026 Pearl River event continues to load from the original `data/` files.

Rainfall retrieval requires complete hourly NOAA AWS MRMS Pass 2 source grids. CREST processing is attempted independently and may be unavailable, in which case the rainfall-only case is retained. Dates before NOAA's AWS archive coverage (notably May 2019) require a separately validated legacy data source and are **not yet supported** by this workflow. Workflow-generated commits may require explicit GitHub Pages deployment if the site's publishing method doesn't react to GITHUB_TOKEN pushes. Existing standalone workflows remain available.


### Coastal marine-inclusive event boundaries
The Generate Historical Event workflow offers **Include adjacent NWS coastal marine zones** (default on). This expands the *analysis area*, not the parish/county's legal boundary. It uses the archived county FIPS polygon plus adjoining polygons from NOAA's current NWS Coastal Marine Zone Forecasts FeatureServer. The exact union geometry and zone IDs/names are recorded in each event's `boundary.geojson`; both QPE and CREST processing use that same file. Disable the option for land/county-only statistics. This boundary is not historically versioned for old events, so note the boundary vintage when comparing older storms. Existing saved events remain unchanged until deliberately regenerated with overwrite enabled.
