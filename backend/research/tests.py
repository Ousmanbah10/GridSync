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
        self.assertIsNone(analyze.call_args.args[2])

    def test_post_passes_a_sanitized_savings_estimate(self):
        payload = {'savings': {'low': 640000, 'high': 1190000, 'percent': 2.8, 'miles': 3.0, 'script': '<x>',
                               'levers': [{'title': 'Shared laydown yard', 'amount': 350000}], 'schedule': 'overlap'}}
        with patch('research.views.get_database', return_value=self.db), patch(
                'research.views.analyze_pair', return_value={'executive_summary': 'ok'}) as analyze:
            self.client.post(f'/api/opportunities/{self.oid}/analysis/', data=json.dumps(payload), content_type='application/json')
        savings = analyze.call_args.args[2]
        self.assertEqual((savings['low'], savings['levers'][0]['amount']), (640000, 350000))
        self.assertNotIn('script', savings)
        self.db.coordination_analyses.insert_one.assert_called_once()
        self.db.coordination_opportunities.update_one.assert_not_called()

    def test_unknown_pair_and_missing_project(self):
        with patch('research.views.get_database', return_value=self.db):
            self.db.projects.find.return_value = [PROJECT]
            self.assertEqual(self.client.post(f'/api/opportunities/{self.oid}/analysis/').status_code, 409)
            self.db.coordination_opportunities.find_one.return_value = None
            self.assertEqual(self.client.get(f'/api/opportunities/{self.oid}/analysis/').status_code, 404)
            self.assertEqual(self.client.get('/api/opportunities/nope/analysis/').status_code, 400)


from datetime import datetime, timezone
from .documents import (dominion_enrichment, georgia_enrichment, index_by_title, normalize_title,
                        parse_dominion, parse_georgia)

DESC_PAGE = """Project 10 of 44
Dominion Energy South Carolina
Planned Transmission Projects $2M and above Total
5 Year Budget
Okatie-Bluffton 115kV: Rebuild
Project ID
6808 S
Project Description
Replace wooden H-Frame structures.
Project Need
End of life.
Project Status
In Progress
Planned In-Service Date
06/01/2025
Estimated Project Cost
Previous 2024 2025 2026 2027 2028 Total*
$6,660,000
$26,800,000
$7,200,000
$0 $0 $0 $40,660,000
*Total Estimated Amount applied to 2025 Rate Base Calculation"""
GA_PAGE = """2024 GA ITS Ten-Year Plan (2025-2034) Page 57 of 304
SAV: MCINTOSH - PURRYSBURG 230KV REACTORS
Teams # 20277
Need Date 06/01/2026 Start Date 01/01/2024
Description
Estimated Cost – GPC REDACTED
* The ITS Assigned designation is for parity forecast purposes only
Install reactors on the McIntosh - Purrysburg 230kV tie lines.
REDACTED
Project advanced in 2025
Project delayed from 2024 to 2027
PUBLIC DISCLOSURE"""


class DocumentTests(SimpleTestCase):
    def test_title_key_ignores_spacing_and_punctuation(self):
        self.assertEqual(normalize_title('Okatie-Bluffton 115 kV: Rebuild'), normalize_title('Okatie-Bluffton 115kV: Rebuild'))

    def test_dominion_cost_schedule_and_estimated_window(self):
        [entry] = parse_dominion(['', DESC_PAGE], 'desc.pdf')
        self.assertEqual((entry['title'], entry['page'], entry['cost']['total']), ('Okatie-Bluffton 115kV: Rebuild', 2, 40660000.0))
        self.assertTrue(entry['cost']['components_match'])
        update, evidence = dominion_enrichment(entry)
        self.assertEqual(update['construction']['basis'], 'annual_spending_schedule')
        self.assertEqual(update['construction']['start_date'], datetime(2024, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(update['construction']['end_date'], datetime(2025, 12, 31, tzinfo=timezone.utc))
        self.assertTrue(all(e['page'] == 2 for e in evidence))

    def test_dominion_total_kept_but_flagged_when_years_do_not_add_up(self):
        [entry] = parse_dominion([DESC_PAGE.replace('$40,660,000', '$41,000,000')], 'desc.pdf')
        update, _ = dominion_enrichment(entry)
        self.assertEqual(update['project_cost']['amount'], 41000000.0)
        self.assertIn('do not add up', update['project_cost']['note'])

    def test_georgia_dates_and_redacted_cost_stay_unknown(self):
        [entry] = parse_georgia([GA_PAGE], 'irp.pdf')
        update, _ = georgia_enrichment(entry)
        self.assertEqual(update['construction']['start_date'], datetime(2024, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(update['construction']['end_date'], datetime(2026, 6, 1, tzinfo=timezone.utc))
        self.assertNotIn('project_cost', update)
        self.assertIn('redacted', update['project_cost_note'])
        self.assertEqual([c['compared_to'] for c in update['schedule_changes']], ['previous Ten-Year Plan', 'previous IRP'])
        self.assertEqual((update['schedule_flag']['kind'], update['schedule_flag']['years']), ('delayed', 3))

    def test_change_lines_are_classified(self):
        from .documents import classify_change, delay_summary
        self.assertEqual(classify_change('No Change')['kind'], 'none')
        self.assertEqual(classify_change('new Project')['kind'], 'new')
        self.assertEqual(classify_change('Project advanced from 2029 to 2027 ')['to_year'], 2027)
        self.assertIsNone(delay_summary([{'compared_to': 'x', **classify_change('No Change')}]))

    def test_duplicate_titles_are_ambiguous(self):
        entry = {'key': 'x'}
        self.assertEqual(index_by_title([entry, dict(entry)]), {})


@override_settings(DEBUG=False, PUBLIC_API=True, PUBLIC_ANALYSIS_PER_HOUR=2, ALLOWED_HOSTS=['testserver'])
class PublicDeploymentTests(SimpleTestCase):
    REMOTE = {'REMOTE_ADDR': '203.0.113.9'}

    def setUp(self):
        cache.clear()
        self.db = MagicMock()
        self.db.projects.find_one.return_value = PROJECT
        self.db.coordination_opportunities.find_one.return_value = OPPORTUNITY
        self.db.projects.find.return_value = [PROJECT, OTHER]

    def test_reads_are_public_but_imports_and_research_are_not(self):
        with patch('research.views.get_database', return_value=self.db):
            self.assertEqual(self.client.get(f'/api/projects/{PROJECT["_id"]}/', **self.REMOTE).status_code, 200)
        self.assertEqual(self.client.post('/api/import/commit/', data='{}', content_type='application/json', **self.REMOTE).status_code, 403)
        self.assertEqual(self.client.post(f'/api/projects/{PROJECT["_id"]}/research/', data='{}', content_type='application/json', **self.REMOTE).status_code, 403)

    def test_public_analysis_is_rate_limited_per_visitor(self):
        with patch('research.views.get_database', return_value=self.db), patch(
                'research.views.analyze_pair', return_value={'executive_summary': 'ok'}):
            codes = [self.client.post(f'/api/opportunities/{OPPORTUNITY["_id"]}/analysis/', **self.REMOTE).status_code for _ in range(3)]
            other = self.client.post(f'/api/opportunities/{OPPORTUNITY["_id"]}/analysis/', REMOTE_ADDR='198.51.100.4').status_code
        self.assertEqual(codes, [201, 201, 429])
        self.assertEqual(other, 201)
