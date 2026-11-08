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

## Drainage Basins reference overlay

The **Drainage Basins** checkbox is off by default. When enabled, thin teal
outlines show USGS Watershed Boundary Dataset (WBD) HUC10 watersheds at every
zoom level. Zooming does not change basin detail or reload basin geometry. Click
an outline for its name and HUC code.
The overlay is independent of the product, archive timestamp, display mode,
product-opacity slider, pins and statistics. It does not change map zoom.

WBD hydrologic units are generalized geographic divisions, **not NWS/RFC forecast
basins, exact upstream contributing areas to individual river points, or evidence
of flooding**. Rainfall, CREST values, thresholds and analysis masks are unchanged.

### Geographic coverage and reproducibility

`python scripts/basins.py` prepares only the land footprints of registered events,
without reprocessing rainfall or CREST archives. It queries official
[USGS WBD](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset)
[FeatureServer](https://hydro-wfs.nationalmap.gov/arcgis/rest/services/wbd/FeatureServer)
layers 5 (HUC10) and 6 (HUC12). It batches all returned object IDs, verifies complete
responses, requests EPSG:4326, validates/repairs polygon geometry, selects by exact
land intersection and retains each selected unit's complete extent. No outlines
are clipped at county lines. Topology-preserving simplification uses 0.0001 degrees
(about 11 m north/south). Asset metadata records source, retrieval UTC, service edit
information when supplied, selection bounds, CRS and simplification tolerance.
These are retrieval snapshots of the current WBD, not historical boundary vintages.

Nonmarine events use their archived footprint, including neighboring counties.
Legacy Pearl River uses county FIPS 28109. Legacy marine-inclusive events reconstruct
only their recorded land counties from the same FIPS reference used by the project;
marine zones never contribute to selection. Newly generated event boundaries also
save `land-boundary.geojson`, the exact land union before adding marine zones.
The county reference cache records its source and retrieval time.

Static GeoJSON lives under `data/basins/<land-hash>/`, shared by identical event
footprints. `data/basins/index.json` maps event IDs to the generated HUC10 and
HUC12 assets; the browser currently requests and displays only HUC10. HUC12 files
are retained for possible future use. The browser requests assets only when
enabled and retains loaded assets for the session;
no live GIS endpoint or nationwide watershed download is required. A failed asset
fetch displays “Drainage basins unavailable” while existing map controls work.
Previously loaded assets can be toggled again during a connection outage. An asset
never loaded cannot be supplied offline; the base map/Leaflet still have their
existing external dependencies.

The historical-event workflow prepares optional basin assets after registering an
event; source failures never block the scientific archive. Existing valid assets
are retained after failed refreshes. Run `python scripts/basins.py --refresh
--require-available` to refresh and validate all events, or add `--event <id>` for
one event. **Prepare USGS drainage basins** in Actions refreshes and commits geography on
the selected branch when run manually; it also creates a downloadable
`usgs-drainage-basins` artifact. No scientific archives are regenerated. Its PR check
retrieves official data on preparation-code changes. No fabricated geometry is
published on failures.

Validation: `python -m unittest discover -s tests -v` and
`node tests/basins.test.cjs`. Test geometries are synthetic fixtures confined to
`tests/`; published assets must come from the official source.

Chromium integration checks run in CI against the published official geometry and
archived products, with external basemap tiles blocked. To repeat locally, install
Playwright under `work/` (`npm install --prefix work --no-save playwright`), run
`work/node_modules/.bin/playwright install --with-deps chromium`, download Leaflet
1.9.4 JS/CSS from jsDelivr into `work/leaflet.js` and `work/leaflet.css`, then run
`NODE_PATH="$PWD/work/node_modules" node tests/browser-basins.cjs`. This checks both
events, neighboring-parish coverage, product/time/mode/opacity changes, fixed HUC10
display while zooming,
real outline clicks, sampling pins, event switching and static-asset failures.

Low-bin product cells are not drawn: rainfall below 0.1 inch and CREST below
100 cfs/mi² leave the basemap visible. This is a display filter only; values,
statistics and sample calculations are unchanged. The opacity slider controls the
remaining colored product cells.

Enabled drainage basins also show small, non-interactive HUC10 names with a dark
halo. Names fall back to HUC identifiers for missing or placeholder names.
Labels are anchored by Leaflet at polygon centers;
only labels within the viewport are shown, and overlapping labels are suppressed.
Panning recalculates label visibility; zooming, event changes and toggling replace
or remove labels together with their outlines. Clicking outlines still opens the
name/HUC popup, and labels do not capture map clicks.

## Product controls, comparison and playback

The compact bar above the map selects **MRMS Rainfall**, **CREST Unit Streamflow**,
or **Both — Swipe Comparison**. Drainage Basins is a separate toggle in that bar,
so HUC10 boundaries and labels can be used with any product. Its adjacent info
button opens the watershed limitations by click, keyboard or touch. On smaller
screens the controls wrap. The sidebar retains the product display options and
statistics; the map and existing charts stay in place.

Swipe Comparison uses two aligned Leaflet product panes in the existing map. The
divider starts centered; drag it with a mouse or touch, or focus it and use the
arrow keys (Home/End move to either edge). Rainfall is on the left and CREST on
the right. Click either side to add a sample pin for the product visible there.
Pin labels show only the sampled value and units (`in.` or `cfs/mi²`) on a white
background with a black outline. In swipe mode each pin follows the divider at
its current map position and shows the product revealed there; in single-product
modes every pin shows that selected product. Pin values refresh during divider
dragging, map movement, archive playback, and product-mode changes, using native
grid times and the existing rainfall hold behavior. A missing value shows `—`.
Rainfall and CREST have independent opacity controls and retain their existing display modes:
event accumulation, rolling 1-hour, or rolling 3-hour rainfall; selected-time or
event-maximum CREST. The two product legends retain inches and cfs/mi² units. CREST uses 14 ascending
display bins (100, 200, 300, 400, 550, 700, 900, 1,200, 1,600,
2,100, 2,800, 3,600, 4,700, 6,000+ cfs/mi²) with colors progressing from
dark yellow through orange, red, pink, purple and blue to white. A compact
floating CREST legend is visible on the map in CREST and swipe modes, hidden
in rainfall-only mode. The same bins appear in the sidebar; the underlying
archived values and statistical thresholds are unchanged.
Drainage boundaries, analysis drawings, applied geometry and map navigation stay
above/below the clipped product panes and remain usable in comparison mode.

Playback controls beneath the map provide Play/Pause, previous/next frame, a
timeline slider, 0.5×/1×/2×/4× pacing, and looping (on by default). The base frame
interval is 500 ms, divided by the selected speed; speed changes animation pace,
not meteorological time. Scrubbing pauses playback. Event changes, unavailable
archives, hidden tabs and page exit stop the timer. Loading another event starts
at its first available timestamp; switching product modes keeps the nearest
available point to the current time.

The archive timeline contains actual source timestamps. In swipe mode it is the
sorted union of rainfall and CREST times: rainfall holds its latest real hourly
frame until another product timestamp is reached, while CREST is shown only for
an exact model timestamp. Missing frames remain unavailable (not zero and not
interpolated). Status text distinguishes each source's valid time and rainfall
accumulation interval from the selected timeline time. CREST event-maximum mode
continues to show the event maximum at each grid cell. If an event has no usable
CREST archive, rainfall remains available and CREST/swipe choices are disabled.
Some older events may have incomplete product coverage or gaps; these display
limitations do not change archived values, thresholds, sampling calculations or
analysis-area statistics.

The dashboard presents NOAA MRMS quantitative precipitation estimates and FLASH
CREST **modeled unit streamflow**, not observed discharge. Rainfall below 0.1 inch
and CREST below 100 cfs/mi² are hidden from the map only; analytical calculations
and thresholds are unchanged. Neither product display implies flood severity.

### Browser regression checks

The Chromium checks exercise real mouse drag, pan and zoom interactions, touch
and keyboard divider input, product toggles, sampling on both swipe sides, basin
selection/reset, playback and missing-frame fixtures, and rectangle/polygon
analysis drawing. The existing drawing suite also verifies review, apply,
edit/cancel and event-reset behavior. After installing Playwright and local
Leaflet assets as described above, run:

```sh
NODE_PATH="$PWD/work/node_modules" node tests/browser-basins.cjs
NODE_PATH="$PWD/work/node_modules" node tests/browser-analysis-area-ui.cjs
node tests/archive-timeline.test.cjs
```

The event validation workflow runs the same browser checks along with Python,
JavaScript, event-index and workflow YAML validation.
