from unittest.mock import patch, MagicMock
from bson import ObjectId
from django.test import SimpleTestCase, override_settings
from .geojson import substations_geojson


class GeoJSONTests(SimpleTestCase):
    def test_valid_and_invalid_locations(self):
        row = {'_id': ObjectId(), 'name': '<script>not html</script>', 'raw_data': {'private': True},
               'location': {'type': 'Point', 'coordinates': [-83.4, 30.5]}, 'voltage_max_kv': 230}
        result = substations_geojson([row, row | {'location': None},
                                     row | {'location': {'type': 'Point', 'coordinates': [0, 91]}}])
        self.assertEqual(len(result['features']), 1)
        self.assertEqual(result['skipped_coordinates'], 2)
        self.assertEqual(result['features'][0]['geometry']['coordinates'], [-83.4, 30.5])
        self.assertEqual(result['features'][0]['id'], str(row['_id']))
        self.assertNotIn('raw_data', result['features'][0]['properties'])

    @override_settings(DEBUG=True)
    def test_endpoint_source_filter_and_remote_guard(self):
        db = MagicMock()
        db.substations.find.return_value = []
        with patch('mapping.views.get_database', return_value=db):
            response = self.client.get('/api/map/substations/?source_id=sample')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.substations.find.call_args.args[0], {'source_id': 'sample'})
        self.assertEqual(response.json()['type'], 'FeatureCollection')
        self.assertEqual(self.client.get('/api/map/substations/', REMOTE_ADDR='203.0.113.1').status_code, 403)


class OverviewTests(SimpleTestCase):
    def test_joins_real_locations_without_inventing_routes(self):
        from .overview import build_overview
        project_id, sub_id, opportunity_id = ObjectId(), ObjectId(), ObjectId()
        project = {'_id': project_id, 'source_id': 's', 'record_id': 'R1', 'project_id': 'P1',
                   'project_name': 'Upgrade', 'owner': 'Utility', 'state_codes': ['GA'],
                   'origin': {'name': 'Station'}, 'status': 'Planning'}
        station = {'_id': sub_id, 'source_id': 's', 'name': 'Station', 'state_code': 'GA',
                   'location': {'type': 'Point', 'coordinates': [-82, 32]}}
        second_id = ObjectId()
        second = project | {'_id': second_id, 'project_id': 'P2', 'record_id': 'R2', 'owner': 'Other utility'}
        opportunity = {'_id': opportunity_id, 'project_record_ids': [project_id, second_id],
                       'distance_km': 0, 'distance_basis': 'substation', 'timeline_overlap': None}
        result = build_overview([project, second], [station], [opportunity])
        self.assertEqual(len(result['project_locations']['features']), 2)
        self.assertEqual(result['routes']['features'], [])
        self.assertEqual(set(result['substations']['features'][0]['properties']['project_record_ids']), {str(project_id), str(second_id)})
        self.assertEqual(result['opportunities'][0]['id'], str(opportunity_id))
        self.assertIsNone(result['opportunities'][0]['timeline_overlap'])

    def test_missing_location_and_stale_opportunities(self):
        from .overview import build_overview
        project = {'_id': ObjectId(), 'source_id': 's', 'project_name': 'Unknown location'}
        result = build_overview([project], [], [{'_id': ObjectId(), 'project_record_ids': [project['_id'], ObjectId()]}])
        self.assertFalse(result['projects'][0]['has_location'])
        self.assertEqual(result['project_locations']['features'], [])
        self.assertEqual(result['opportunities'], [])


class DemoTests(SimpleTestCase):
    def test_stable_diverse_subset_preserves_input(self):
        from .demo import select_demo
        rows = [{'project_record_id': str(i), 'project_id': str(i), 'has_location': True,
                 'state_codes': [['GA', 'SC', 'NC'][i % 3]], 'project_type': ['Line', 'Upgrade'][i % 2]}
                for i in range(140)]
        chosen = select_demo(rows, [])
        self.assertEqual(len(chosen), 100)
        self.assertEqual(chosen, select_demo(list(reversed(rows)), []))
        self.assertEqual(len(rows), 140)
        self.assertEqual({s for p in rows if p['project_record_id'] in chosen for s in p['state_codes']}, {'GA', 'SC', 'NC'})

    def test_demo_excludes_unlocated_projects_even_when_paired(self):
        from .demo import select_demo
        rows = [{'project_record_id': 'located', 'has_location': True},
                {'project_record_id': 'missing', 'has_location': False}]
        pairs = [{'id': 'pair', 'project_record_ids': ['located', 'missing'], 'distance_km': 1}]
        self.assertEqual(select_demo(rows, pairs), {'located'})
