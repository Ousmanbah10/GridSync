from unittest.mock import MagicMock, patch
import json
from bson import ObjectId
from django.core.cache import cache
from django.test import SimpleTestCase, Client, override_settings
from .ai import analyze_pair, chat, research_project
from .evidence import collect_sources, validate_findings, web_url


def response(text, **metadata):
    return {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': text}]}, **metadata}]}


PROJECT = {'_id': ObjectId(), 'project_name': 'North line', 'owner': 'Utility A',
           'state_codes': ['GA'], 'source_urls': ['https://utility.example/project.pdf'],
           'raw_data': {'private': 'not for AI'}}
REPORT = 'The North line project is planned to start construction in 2029.'
SOURCES = [{'id': 'S1', 'url': 'https://utility.example/project.pdf', 'title': 'North line'}]
FINDING = {'field': 'construction_start', 'value': '2029', 'supporting_passage': REPORT,
           'source_ids': ['S1'], 'published_date': '', 'scope_note': 'Planned year, not an exact date.'}


class EvidenceTests(SimpleTestCase):
    def test_citation_allowlist_comes_from_tools_not_model_urls(self):
        candidate = response('See https://invented.example', urlContextMetadata={'urlMetadata': [
            {'retrievedUrl': SOURCES[0]['url'], 'urlRetrievalStatus': 'URL_RETRIEVAL_STATUS_SUCCESS'},
            {'retrievedUrl': 'https://failed.example', 'urlRetrievalStatus': 'URL_RETRIEVAL_STATUS_ERROR'},
        ]})['candidates'][0]
        sources, retrievals = collect_sources(candidate)
        self.assertEqual([s['url'] for s in sources], [SOURCES[0]['url']])
        self.assertEqual(len(retrievals), 2)

    def test_invalid_or_unsubstantiated_findings_are_discarded(self):
        findings, rejected = validate_findings({'findings': [
            FINDING, FINDING | {'source_ids': ['INVENTED']},
            FINDING | {'supporting_passage': 'This sentence is not in the report.'},
            FINDING | {'field': 'made_up'}, FINDING | {'value': None},
        ]}, SOURCES, REPORT)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]['review_status'], 'pending')
        self.assertEqual(findings[0]['value'], '2029')
        self.assertEqual(rejected, 4)

    def test_rejects_unsafe_links(self):
        for url in ['javascript:alert(1)', 'http://127.0.0.1/', 'http://localhost/', 'http://10.0.0.1/',
                    'https://user:password@example.com', 'https://example.com:8000']:
            self.assertIsNone(web_url(url))
        self.assertEqual(web_url('https://utility.example/report.pdf'), 'https://utility.example/report.pdf')


@override_settings(GEMINI_MODEL='test-model')
class ResearchTests(SimpleTestCase):
    def test_no_grounding_never_becomes_saved_facts(self):
        with patch('research.ai.call', return_value=response('The budget is $9 billion.')) as call:
            result = research_project(PROJECT)
        self.assertEqual(result['outcome'], 'no_evidence')
        self.assertEqual(result['findings'], [])
        self.assertEqual(call.call_count, 1)
        self.assertNotIn('$9 billion', result['report'])

    def test_link_research_extracts_proposals_without_mutating_project(self):
        result = response(REPORT, urlContextMetadata={'urlMetadata': [
            {'retrievedUrl': SOURCES[0]['url'], 'urlRetrievalStatus': 'URL_RETRIEVAL_STATUS_SUCCESS'}]})
        with patch('research.ai.call', side_effect=[result, response(json.dumps({'findings': [FINDING]}))]) as call:
            researched = research_project(PROJECT, search=False)
        self.assertEqual(researched['findings'][0]['value'], '2029')
        self.assertEqual(call.call_args_list[0].args[0]['tools'], [{'url_context': {}}])
        self.assertNotIn('raw_data', json.dumps(call.call_args_list[0].args[0]))
        self.assertNotIn('construction', PROJECT)
        self.assertEqual(researched['missing_fields'][0], 'construction_end')

    def test_failed_structuring_retains_grounded_report(self):
        result = response(REPORT, groundingMetadata={'groundingChunks': [{'web': {'uri': SOURCES[0]['url']}}]})
        with patch('research.ai.call', side_effect=[result, ValueError('Model unavailable')]):
            researched = research_project(PROJECT)
        self.assertEqual(researched['outcome'], 'report_only')
        self.assertEqual(researched['report'], REPORT)
        self.assertEqual(researched['findings'], [])

    def test_chat_excludes_rejected_evidence_and_has_no_search_tools(self):
        run = {'_id': ObjectId(), 'findings': [
            FINDING | {'id': 'F1', 'review_status': 'pending'},
            FINDING | {'id': 'F2', 'value': 'secret-rejected-value', 'review_status': 'rejected'}]}
        with patch('research.ai.call', return_value=response(json.dumps({'answers': [
                {'text': 'Unverified: construction may begin in 2029.', 'evidence_ids': ['F1']},
                {'text': 'Unsupported', 'evidence_ids': ['F2']}]}))) as call:
            answer = chat(PROJECT, run, 'When does it start?')
        self.assertEqual(len(answer['answers']), 1)
        self.assertNotIn('tools', call.call_args.args[0])
        self.assertNotIn('secret-rejected-value', json.dumps(call.call_args.args[0]))

    def test_cannot_research_no_links_without_search(self):
        with self.assertRaisesRegex(ValueError, 'no usable source links'):
            research_project(PROJECT | {'source_urls': []}, search=False)


@override_settings(DEBUG=True)
class ResearchApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.pid, self.rid = str(PROJECT['_id']), str(ObjectId())
        self.db = MagicMock()
        self.db.projects.find_one.return_value = PROJECT

    def test_csrf_and_local_guards(self):
        response = Client(enforce_csrf_checks=True).post(f'/api/projects/{self.pid}/research/',
                                                         data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get('/api/projects/', REMOTE_ADDR='203.0.113.1').status_code, 403)

    def test_unknown_projects_and_invalid_ids(self):
        self.db.projects.find_one.return_value = None
        with patch('research.views.get_database', return_value=self.db):
            self.assertEqual(self.client.get(f'/api/projects/{self.pid}/').status_code, 404)
            self.assertEqual(self.client.get('/api/projects/not-an-id/').status_code, 400)

    def test_research_is_saved_separately_and_original_never_updated(self):
        with patch('research.views.get_database', return_value=self.db), patch(
                'research.views.research_project', return_value={'findings': [], 'outcome': 'no_evidence'}):
            result = self.client.post(f'/api/projects/{self.pid}/research/', data=json.dumps({'search': True}),
                                      content_type='application/json')
        self.assertEqual(result.status_code, 201)
        saved = self.db.project_research.insert_one.call_args.args[0]
        self.assertEqual(saved['project_record_id'], PROJECT['_id'])
        self.db.projects.update_one.assert_not_called()

    def test_review_is_scoped_to_project_and_run(self):
        self.db.project_research.update_one.return_value.matched_count = 0
        with patch('research.views.get_database', return_value=self.db):
            response = self.client.post(f'/api/projects/{self.pid}/research/{self.rid}/review/',
                data=json.dumps({'finding_id': 'F1', 'status': 'reviewed'}), content_type='application/json')
        self.assertEqual(response.status_code, 404)
        query = self.db.project_research.update_one.call_args.args[0]
        self.assertEqual(query['project_record_id'], PROJECT['_id'])
        self.assertEqual(query['_id'], ObjectId(self.rid))

    def test_rejects_chat_run_from_another_project(self):
        self.db.project_research.find_one.return_value = None
        with patch('research.views.get_database', return_value=self.db), patch('research.views.chat') as chat_call:
            response = self.client.post(f'/api/projects/{self.pid}/chat/', data=json.dumps(
                {'question': 'Budget?', 'run_id': self.rid}), content_type='application/json')
        self.assertEqual(response.status_code, 404)
        chat_call.assert_not_called()

    def test_non_object_json_and_invalid_questions(self):
        with patch('research.views.get_database', return_value=self.db):
            for data in ['[]', '{"question": " "}', '{"question": 12}']:
                self.assertEqual(self.client.post(f'/api/projects/{self.pid}/chat/', data=data,
                                                  content_type='application/json').status_code, 400)


OTHER = {'_id': ObjectId(), 'project_name': 'South line', 'owner': 'Utility B', 'state_codes': ['SC'],
         'raw_data': {'private': 'not for AI'}}
OPPORTUNITY = {'_id': ObjectId(), 'project_record_ids': [PROJECT['_id'], OTHER['_id']], 'distance_km': 4.7,
               'distance_basis': 'approximate_corridor', 'band': 'shared_logistics'}
ANALYSIS = {'executive_summary': 'Close enough to share staging.', 'key_insights': ['4.7 km apart.', '', 7],
            'resource_opportunities': [{'resource': 'staging areas', 'rationale': 'Within 8 km.'}, {'resource': 3}],
            'risks': ['Geometry is approximate.'], 'next_steps': ['Confirm dates.'],
            'recommendation': ['Open a planning discussion.'], 'cost_outlook': 'No published costs.'}


@override_settings(DEBUG=True)
class PairAnalysisTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.oid = str(OPPORTUNITY['_id'])
        self.db = MagicMock()
        self.db.coordination_opportunities.find_one.return_value = OPPORTUNITY
        self.db.projects.find.return_value = [OTHER, PROJECT]

    def test_analysis_uses_records_without_tools_or_raw_data(self):
        with patch('research.ai.call', return_value=response(json.dumps(ANALYSIS))) as call:
            result = analyze_pair(OPPORTUNITY, [PROJECT, OTHER])
        sent = call.call_args.args[0]
        self.assertNotIn('tools', sent)
        self.assertNotIn('not for AI', json.dumps(sent))
        self.assertEqual(result['key_insights'], ['4.7 km apart.'])
        self.assertEqual(result['resource_opportunities'], [{'resource': 'staging areas', 'rationale': 'Within 8 km.'}])

    def test_empty_summary_is_rejected(self):
        with patch('research.ai.call', return_value=response(json.dumps({**ANALYSIS, 'executive_summary': ' '}))):
            with self.assertRaises(ValueError):
                analyze_pair(OPPORTUNITY, [PROJECT, OTHER])

    def test_post_saves_analysis_in_its_own_collection(self):
        with patch('research.views.get_database', return_value=self.db), patch(
                'research.views.analyze_pair', return_value={'executive_summary': 'ok'}) as analyze:
            reply = self.client.post(f'/api/opportunities/{self.oid}/analysis/')
        self.assertEqual(reply.status_code, 201)
        self.assertEqual([p['_id'] for p in analyze.call_args.args[1]], [PROJECT['_id'], OTHER['_id']])
        self.db.coordination_analyses.insert_one.assert_called_once()
        self.db.coordination_opportunities.update_one.assert_not_called()

    def test_unknown_pair_and_missing_project(self):
        with patch('research.views.get_database', return_value=self.db):
            self.db.projects.find.return_value = [PROJECT]
            self.assertEqual(self.client.post(f'/api/opportunities/{self.oid}/analysis/').status_code, 409)
            self.db.coordination_opportunities.find_one.return_value = None
            self.assertEqual(self.client.get(f'/api/opportunities/{self.oid}/analysis/').status_code, 404)
            self.assertEqual(self.client.get('/api/opportunities/nope/analysis/').status_code, 400)
