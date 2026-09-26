from copy import deepcopy
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch
import json

from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, Client, override_settings
from database.importing.workbook import read_workbook, MAX_FILE_BYTES
from database.importing.mapping import get_mapping, validate_mapping
from database.importing.service import build_preview, import_preview

WORKBOOK = Path(__file__).resolve().parent.parent / 'OurGridFuture_PlannedTransmissionProjects_Jun2026.xlsx'


class ExtractionTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.content = WORKBOOK.read_bytes()
        cls.preview = build_preview(cls.content, WORKBOOK.name)

    def test_real_workbook_counts_and_provenance(self):
        self.assertEqual(len(self.preview['documents']['projects']), 722)
        self.assertEqual(len(self.preview['documents']['substations']), 1083)
        self.assertEqual(self.preview['errors'], [])
        first = self.preview['documents']['projects'][0]
        self.assertEqual(first['in_service_year'], 2031)
        self.assertEqual(first['raw_data']['Capacity (MW)'], '0')
        self.assertIsNone(first['capacity_mw'])
        self.assertEqual(first['source_row'], 2)
        self.assertEqual(first['status_updated_at'].year, 2026)
        self.assertNotIn('route', first)
        self.assertIn('Abramson', self.preview['source']['citation'])

    def test_coordinates_and_duplicate_substations_are_preserved(self):
        docs = self.preview['documents']['substations']
        self.assertEqual(docs[0]['location']['coordinates'], [-83.393596, 30.525098])
        repeated = [doc for doc in docs if doc['substation_id'] == 'S-0918']
        self.assertEqual(len(repeated), 2)
        self.assertNotEqual(repeated[0]['source_row'], repeated[1]['source_row'])
        self.assertTrue(any('S-0918' in warning for warning in self.preview['warnings']))

    def test_same_file_has_stable_identity(self):
        other = build_preview(self.content, 'renamed.xlsx')
        self.assertEqual(other['source']['source_id'], self.preview['source']['source_id'])

    def test_invalid_and_oversized_files(self):
        for content in (b'not an xlsx', b'', b'x' * (MAX_FILE_BYTES + 1)):
            with self.assertRaises(ValueError):
                read_workbook(content)

    def test_duplicate_project_ids_block_import(self):
        sheets, date1904 = read_workbook(self.content)
        sheets[1]['rows'][2][1]['A'] = sheets[1]['rows'][1][1]['A']
        with patch('database.importing.service.read_workbook', return_value=(sheets, date1904)):
            data = build_preview(self.content, WORKBOOK.name)
        self.assertTrue(any('Duplicate project Record ID' in e for e in data['errors']))
        db = MagicMock()
        with self.assertRaises(ValueError):
            import_preview(db, data)
        db.list_collections.assert_not_called()

    def test_invalid_coordinates_and_uncertain_year_remain_unknown(self):
        sheets, date1904 = read_workbook(self.content)
        sheets[1]['rows'][1][1]['N'] = '2030–2035'
        sheets[3]['rows'][1][1]['G'] = '999'
        with patch('database.importing.service.read_workbook', return_value=(sheets, date1904)):
            data = build_preview(self.content, WORKBOOK.name)
        first = data['documents']['projects'][0]
        self.assertIsNone(first['in_service_year'])
        self.assertEqual(first['in_service_year_raw'], '2030–2035')
        self.assertNotIn('location', data['documents']['substations'][0])

    def test_import_uses_insert_only_and_reports_existing_rows(self):
        db = MagicMock()
        data = deepcopy(self.preview)
        data['documents'] = {key: values[:1] for key, values in data['documents'].items()}
        db.__getitem__.return_value.bulk_write.return_value.upserted_count = 0
        with patch('database.importing.service.setup_database', return_value=[]):
            result = import_preview(db, data)
        self.assertEqual(result['projects'], {'inserted': 0, 'existing': 1})
        self.assertIn('$setOnInsert', db.sources.update_one.call_args.args[1])
        operations = db.__getitem__.return_value.bulk_write.call_args.args[0]
        self.assertEqual(set(operations[0]._doc), {'$setOnInsert'})


class GeminiMappingTests(SimpleTestCase):
    def test_rejects_fabricated_columns_and_missing_required_fields(self):
        with self.assertRaises(ValueError):
            validate_mapping({'record_id': 'invented'}, ['Record ID'], 'projects')
        with self.assertRaises(ValueError):
            validate_mapping({'record_id': 'Record ID'}, ['Record ID'], 'projects')

    @override_settings(GEMINI_API_KEY='')
    def test_missing_key_is_actionable(self):
        with self.assertRaisesRegex(ValueError, 'GEMINI_API_KEY'):
            get_mapping(['Record ID'], 'projects', True)

    @override_settings(GEMINI_API_KEY='test-key', GEMINI_MODEL='gemini-3.8-flash')
    def test_gemini_only_receives_headers_and_validates_output(self):
        output = {'mappings': [
            {'field': 'record_id', 'column': 'Record ID'},
            {'field': 'project_id', 'column': 'Project ID'},
            {'field': 'project_name', 'column': 'Project name'}]}
        response = BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(output)}]}}]}).encode())
        with patch('database.importing.mapping.urlopen', return_value=response) as call:
            result = get_mapping(['Record ID', 'Project ID', 'Project name'], 'projects', True)
        self.assertEqual(result['project_name'], 'Project name')
        self.assertNotIn('test-key', call.call_args.args[0].data.decode())
        self.assertNotIn(settings.MONGODB_URI, call.call_args.args[0].data.decode())


@override_settings(DEBUG=True)
class ApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_remote_access_is_rejected(self):
        response = self.client.get('/api/status/', REMOTE_ADDR='203.0.113.1')
        self.assertEqual(response.status_code, 403)

    @override_settings(DEBUG=False)
    def test_disabled_outside_development(self):
        self.assertEqual(self.client.get('/api/status/').status_code, 403)

    def test_csrf_is_required_for_uploads(self):
        response = Client(enforce_csrf_checks=True).post('/api/import/preview/', {'sample': 'true'})
        self.assertEqual(response.status_code, 403)

    def test_preview_and_expired_token(self):
        response = self.client.post('/api/import/preview/', {'sample': 'true', 'use_ai': 'false'})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['counts'], {'projects': 722, 'substations': 1083})
        self.assertNotIn('raw_data', data['records']['projects'][0])
        cache.clear()
        response = self.client.post('/api/import/commit/', json.dumps({'token': data['token']}), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('expired', response.json()['error'])

    def test_malformed_commit(self):
        response = self.client.post('/api/import/commit/', '[]', content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_commit_uses_server_preview_not_browser_documents(self):
        token = 'a' * 32
        stored = {'errors': [], 'documents': {'projects': [], 'substations': []}}
        cache.set('import:' + token, stored)
        with patch('database.views.get_database', return_value=MagicMock()), patch('database.views.import_preview', return_value={}) as importer:
            response = self.client.post('/api/import/commit/', json.dumps({
                'token': token, 'documents': {'projects': [{'project_name': 'tampered'}]},
            }), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(importer.call_args.args[1], stored)

    def test_database_error_does_not_expose_credentials(self):
        from pymongo.errors import ConnectionFailure
        token = 'b' * 32
        cache.set('import:' + token, {'errors': []})
        with patch('database.views.get_database', side_effect=ConnectionFailure('secret-connection-uri')):
            response = self.client.post('/api/import/commit/', json.dumps({'token': token}), content_type='application/json')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret-connection-uri', response.content.decode())
        self.assertIsNone(cache.get('import-lock'))
