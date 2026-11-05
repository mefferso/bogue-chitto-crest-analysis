# Drainage Basins Implementation Plan

> Execute inline using superpowers:executing-plans; autonomous implementation and merge authorized in the supplied task.

**Goal:** Optional event-specific USGS WBD HUC10/HUC12 reference outlines.
**Architecture:** Python prepares static, content-addressed coverage assets and an event manifest; an independent Leaflet controller loads one resolution on demand.
**Tech Stack:** Python requests/Shapely, vanilla JavaScript/Leaflet, GitHub Actions/Pages.
**Spec:** User-supplied “Codex Task — Add Interactive River Drainage Basin Overlay”.

## Global constraints
- Official WBD only; full polygons selected geographically by event land counties, excluding marine zones.
- Legacy Pearl River FIPS 28109 and neighboring counties supported; no analysis archive changes.
- Off by default; zoom 11 switches HUC10 to HUC12; independent of products, timestamps and opacity.
- Static assets only in browser; explicit unavailable state; provenance and conservative simplification.

## Review focus
- Stale requests after event/zoom/off changes must never render old coverage.
- Marine-inclusive archived unions must not select unrelated inland HUCs.
- Record limits must not silently truncate results.
- New event preparation failure must preserve existing maps and cached assets.
- Raster clicks, pins, timelines and unified opacity must remain operational.

## Task 1: Static data preparation
- [x] Write tests for land selection (legacy, neighbors, marine), full geometry retention, pagination, malformed data, reuse and failed retrieval.
- [x] Run failing tests, implement scripts/basins.py, run Python test suite.
- [x] Use county reference polygons for legacy/marine reconstruction; use exact archived union for nonmarine events. Keep exact pre-marine land geometry for future events.
- [x] Publish data/basins/index.json with event status and relative HUC asset paths; hash land geometry for cross-event reuse. Record layer metadata, retrieval time, CRS and simplification tolerance.

## Task 2: Leaflet overlay
- [x] Write Node controller tests for on/off, zoom replacement, stale event requests, retry and failure.
- [x] Implement drainage-basins.js and minimal index.html hooks; use separate pane with transparent interiors and line-only hit detection.
- [x] Test integration with current product/time/mode/opacity controls and real browser if available.

## Task 3: Automation and delivery
- [x] Add standalone basin refresh workflow plus optional event-generation step; no rainfall archive regeneration.
- [x] Generate assets through GitHub Actions if managed environment blocks USGS access; never fabricate published geometry.
- [x] Update documentation and validation workflow; run Python/Node, syntax, YAML, static geometry and browser checks.
- [ ] Review branch, refresh main, create PR, wait for checks, merge and verify Pages when accessible.
