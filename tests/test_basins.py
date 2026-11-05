import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from shapely.geometry import box, mapping, shape
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

# Synthetic geometry below is exclusively a test fixture, never published WBD data.
def feature(geom, **props):
    return {'type':'Feature','properties':props,'geometry':mapping(geom)}

class BasinsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('basins'), 'basin preparation module must exist')
        import basins
        self.b = basins

    def test_legacy_and_neighbors_exclude_marine(self):
        counties={'28109':box(0,0,1,1),'22051':box(2,0,3,1),'22071':box(3,0,4,1)}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            event={'id':'2026-10-31_pearl-river-ms','data_dir':'data'}
            self.assertTrue(self.b.land_footprint(event,root,counties).equals(counties['28109']))
            boundary=feature(box(2,0,20,20),fips='22051',mode='county_and_neighbors_and_marine',surrounding_counties=['22071'],marine_zones=[{'id':'marine'}])
            (root/'boundary.geojson').write_text(json.dumps(boundary))
            event={'id':'coastal','boundary_file':'boundary.geojson'}
            land=self.b.land_footprint(event,root,counties)
            self.assertAlmostEqual(land.area,2)
            self.assertFalse(land.intersects(box(10,10,11,11)))

    def test_archived_nonmarine_geometry_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); geom=box(0,0,2,2)
            (root/'boundary.geojson').write_text(json.dumps(feature(geom,fips='22051',marine_zones=[])))
            land=self.b.land_footprint({'boundary_file':'boundary.geojson'},root,{})
            self.assertTrue(land.equals(geom))

    def test_future_boundary_archives_exact_land_before_marine_union(self):
        import boundary
        from unittest.mock import Mock
        county=feature(box(0,0,1,1));county['id']='22051'
        marine=feature(box(0,-1,1,0),ID='GMZ000',NAME='Test marine')
        responses=[]
        for data in [{'features':[county]},{'features':[county]},{'features':[marine]}]:
            response=Mock();response.json.return_value=data;responses.append(response)
        with tempfile.TemporaryDirectory() as d,patch.object(boundary.requests,'get',side_effect=responses):
            root=Path(d)
            result=boundary.generate('22051',root/'boundary.geojson',marine=True)
            self.assertTrue((root/'land-boundary.geojson').exists())
            self.assertTrue(shape(json.loads((root/'land-boundary.geojson').read_text())['geometry']).equals(box(0,0,1,1)))
            self.assertGreater(shape(result['geometry']).area,1)

    def test_selection_retains_full_extent_and_name(self):
        features=[feature(box(-2,-2,2,2),huc10='1234567890',name='Watershed'),feature(box(5,5,6,6),huc10='9876543210',name='Other')]
        selected=self.b.select_features(features,box(0,0,1,1),10)
        self.assertEqual(len(selected),1)
        self.assertEqual(selected[0]['properties']['huc'],'1234567890')
        self.assertEqual(selected[0]['properties']['name'],'Watershed')
        self.assertEqual(shape(selected[0]['geometry']).bounds,(-2,-2,2,2))

    def test_invalid_huc_and_nonpolygon_fail(self):
        with self.assertRaises(ValueError):
            self.b.select_features([feature(box(0,0,1,1),huc10='bad')],box(0,0,1,1),10)
        with self.assertRaises(ValueError):
            self.b.select_features([{'properties':{'huc10':'1234567890'},'geometry':None}],box(0,0,1,1),10)

    def test_id_batches_do_not_truncate_at_record_limit(self):
        calls=[]
        def request(url,params):
            calls.append(params)
            if params.get('returnIdsOnly')=='true':return {'objectIdFieldName':'OBJECTID','objectIds':[3,1,2]}
            return {'type':'FeatureCollection','features':[feature(box(0,0,1,1),huc10=str(i).zfill(10),name=str(i),OBJECTID=i) for i in map(int,params['objectIds'].split(','))]}
        with patch.object(self.b,'get_json',side_effect=request):
            result=self.b.query_features(5,box(0,0,1,1),batch_size=2)
        self.assertEqual(len(result),3)
        self.assertEqual([len(p['objectIds'].split(',')) for p in calls[1:]],[2,1])
        self.assertTrue(all(p['outSR']==4326 for p in calls[1:]))

    def test_missing_records_fail_instead_of_partial_publish(self):
        def request(url,params):
            if params.get('returnIdsOnly')=='true':return {'objectIdFieldName':'OBJECTID','objectIds':[1,2]}
            return {'features':[feature(box(0,0,1,1),OBJECTID=1,huc10='1234567890')]}
        with patch.object(self.b,'get_json',side_effect=request),self.assertRaises(ValueError):
            self.b.query_features(5,box(0,0,1,1))

    def test_failure_preserves_old_manifest_and_assets(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'data/basins').mkdir(parents=True)
            event={'id':'legacy','fips':'28109','data_dir':'data'}
            (root/'data/events.json').write_text(json.dumps({'events':[event]}))
            with patch.object(self.b,'load_counties',return_value={'28109':box(0,0,1,1)}),patch.object(self.b,'query_features',side_effect=RuntimeError('unreachable')):
                result=self.b.prepare(root)
            self.assertEqual(result['events']['legacy']['status'],'unavailable')
            # Next success publishes two valid resolutions; next failure retains them.
            def query(layer,land):
                level=10 if layer==5 else 12
                return [feature(box(-1,-1,2,2),**{f'huc{level}':'1'*level,'name':'Test only'})]
            with patch.object(self.b,'load_counties',return_value={'28109':box(0,0,1,1)}),patch.object(self.b,'query_features',side_effect=query),patch.object(self.b,'get_json',return_value={'name':'WBD','editingInfo':{'lastEditDate':123}}):
                result=self.b.prepare(root,refresh=True)
            self.assertEqual(result['events']['legacy']['status'],'available')
            old=result['events']['legacy']['levels']
            with patch.object(self.b,'load_counties',return_value={'28109':box(0,0,1,1)}),patch.object(self.b,'query_features',side_effect=RuntimeError('unreachable')):
                result=self.b.prepare(root,refresh=True)
            self.assertEqual(result['events']['legacy']['levels'],old)
            self.assertEqual(result['events']['legacy']['status'],'available')
            self.assertIn('last_refresh_error',result['events']['legacy'])

if __name__=='__main__':unittest.main()
