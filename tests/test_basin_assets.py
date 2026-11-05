"""Verify published official snapshots, independently of preparation mocks."""
import json
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from basins import SOURCE, land_footprint, load_counties, polygon
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]

class PublishedBasinsTests(unittest.TestCase):
    def test_official_event_coverage_is_valid_and_complete(self):
        index=json.loads((ROOT/'data/basins/index.json').read_text())
        counties=load_counties(ROOT)
        events=json.loads((ROOT/'data/events.json').read_text())['events']
        for event in events:
            land=land_footprint(event,ROOT,counties)
            coverage=index['events'][event['id']]
            # Future retrieval failures may legitimately publish unavailable coverage.
            if coverage['status']=='unavailable':
                self.assertNotIn(event['id'],['2026-10-31_pearl-river-ms','2026-10-31_jefferson-parish-la'])
                continue
            for level,path in coverage['levels'].items():
                with self.subTest(event=event['id'],level=level):
                    doc=json.loads((ROOT/path).read_text())
                    self.assertEqual(doc['metadata']['source'],SOURCE)
                    self.assertEqual(doc['metadata']['crs'],'EPSG:4326')
                    self.assertTrue(doc['metadata']['retrieved_utc'])
                    codes=[f['properties']['huc'] for f in doc['features']]
                    self.assertEqual(len(codes),len(set(codes)))
                    self.assertTrue(all(c.isdigit() and len(c)==int(level) for c in codes))
                    geoms=[polygon(f['geometry']) for f in doc['features']]
                    self.assertTrue(all(g.intersects(land) for g in geoms))
                    combined=unary_union(geoms)
                    self.assertGreater(combined.intersection(land).area/land.area,.99)
                    self.assertGreater(combined.difference(land).area,0)
                    if event['id'] in ('2026-10-31_pearl-river-ms','2026-10-31_jefferson-parish-la'):
                        self.assertTrue(-92<combined.bounds[0]<-88 and 28<combined.bounds[1]<31)
                    self.assertLess((ROOT/path).stat().st_size,3*1024*1024)

if __name__=='__main__':unittest.main()
