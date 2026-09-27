from copy import deepcopy
from math import pi
from unittest import TestCase
from unittest.mock import MagicMock
from bson import ObjectId
from .geometry import EARTH_RADIUS_KM, haversine_km, route_segments, route_distance
from .rules import classify, distance_score
from .locations import LocationResolver
from .engine import rank_projects
from .repository import opportunity_id, save_results


def project(index, point=None, **changes):
    row = {'_id': ObjectId(f'{index:024x}'), 'source_id': 'source', 'project_id': f'P{index}',
           'record_id': f'R{index}', 'project_name': f'Project {index}', 'status': 'Planning',
           'dataset_kind': 'planned_project', 'state_codes': ['GA'], 'owner': f'Utility {index}'}
    if point is not None:
        row['origin'] = {'location': {'type': 'Point', 'coordinates': point}}
    return row | changes


def route(*points):
    return {'type': 'LineString', 'coordinates': list(points)}


class GeometryTests(TestCase):
    def test_known_distances_and_symmetry(self):
        self.assertEqual(haversine_km((0, 0), (0, 0)), 0)
        self.assertAlmostEqual(haversine_km((0, 0), (1, 0)), 111.195080, places=5)
        self.assertAlmostEqual(haversine_km((0, 0), (180, 0)), pi * EARTH_RADIUS_KM)
        self.assertAlmostEqual(haversine_km((-80, 33), (-81, 34)), haversine_km((-81, 34), (-80, 33)))

    def test_dateline_and_poles(self):
        self.assertAlmostEqual(haversine_km((179.9, 0), (-179.9, 0)), 22.239016, places=5)
        self.assertLess(haversine_km((20, 90), (-80, 90)), 1e-9)

    def test_invalid_coordinates(self):
        for point in ((0, 91), (181, 0), (float('nan'), 0), (True, 0), (0,), ('1', 0)):
            with self.assertRaises(ValueError):
                haversine_km(point, (0, 0))

    def test_route_cross_touch_overlap_and_disjoint(self):
        base = route_segments(route((-1, 0), (1, 0)))
        for other in (route((0, -1), (0, 1)), route((1, 0), (1, 1)), route((0, 0), (2, 0))):
            self.assertEqual(route_distance(base, route_segments(other)), (0.0, True))
        distance, crossing = route_distance(base, route_segments(route((2, 0), (3, 0))))
        self.assertFalse(crossing)
        self.assertAlmostEqual(distance, haversine_km((1, 0), (2, 0)))

    def test_route_nearest_point_is_inside_segment(self):
        a = route_segments(route((-1, 0), (1, 0)))
        b = route_segments(route((0, 0.01), (0, 0.02)))
        distance, crossing = route_distance(a, b)
        self.assertFalse(crossing)
        self.assertAlmostEqual(distance, haversine_km((0, 0), (0, 0.01)), places=6)

    def test_dateline_route_crossing_and_multiline(self):
        a = route_segments(route((179, 0), (-179, 0)))
        b = route_segments({'type': 'MultiLineString', 'coordinates': [
            [[0, 1], [1, 1]], [[180, -1], [180, 1]]]})
        self.assertEqual(route_distance(a, b), (0.0, True))

    def test_degenerate_and_antipodal_routes(self):
        a = route_segments(route((0, 0), (0, 0)))
        b = route_segments(route((-1, 0), (1, 0)))
        self.assertEqual(route_distance(a, b), (0.0, True))
        with self.assertRaises(ValueError):
            route_segments(route((0, 0), (180, 0)))


class RuleTests(TestCase):
    def test_exact_exclusive_boundaries(self):
        for distance, band in [(0, 'shared_land'), (1.599999, 'shared_land'),
                               (1.6, 'shared_logistics'), (7.999999, 'shared_logistics'),
                               (8, 'shared_crews_equipment'), (39.999999, 'shared_crews_equipment')]:
            self.assertEqual(classify(distance)['band'], band)
        self.assertIsNone(classify(40))
        self.assertIsNone(classify(50))
        self.assertEqual(classify(0, True)['band'], 'touching_crossing')
        self.assertFalse(classify(0)['must_coordinate'])
        with self.assertRaises(ValueError):
            classify(1, True)

    def test_monotonic_score(self):
        self.assertEqual(distance_score(0), 100)
        self.assertGreater(distance_score(1), distance_score(2))
        self.assertEqual(distance_score(40), 0)
        for value in (-1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                classify(value)


class MatchingTests(TestCase):
    def setUp(self):
        self.sub = {'_id': ObjectId(), 'source_id': 'source', 'name': 'Hanson', 'state_code': 'GA',
                    'location': {'type': 'Point', 'coordinates': [-83, 30]}}
        self.row = project(1, origin={'name': ' HANSON '})

    def test_exact_name_state_and_source(self):
        points, evidence, issues = LocationResolver([self.sub]).resolve(self.row)
        self.assertEqual(points, [(-83.0, 30.0)])
        self.assertEqual(evidence[0]['method'], 'exact_name_and_project_state')
        self.assertEqual(issues, [])
        for change in ({'source_id': 'other'}, {'state_code': 'FL'}):
            self.assertEqual(LocationResolver([self.sub | change]).resolve(self.row)[0], [])

    def test_ambiguous_names_and_missing_states_not_guessed(self):
        self.assertEqual(LocationResolver([self.sub, self.sub | {'_id': ObjectId()}]).resolve(self.row)[0], [])
        self.assertEqual(LocationResolver([self.sub]).resolve(self.row | {'state_codes': []})[0], [])

    def test_explicit_reference_can_resolve_ambiguity(self):
        resolver = LocationResolver([self.sub, self.sub | {'_id': ObjectId()}])
        row = self.row | {'origin': {'substation_id': self.sub['_id']}}
        self.assertEqual(resolver.resolve(row)[0], [(-83.0, 30.0)])


class EngineTests(TestCase):
    def test_closest_pair_and_order(self):
        a = project(1, (0, 0), destination={'location': {'type': 'Point', 'coordinates': [0.1, 0]}})
        result = rank_projects([a, project(2, (0.11, 0)), project(3, (0.3, 0))], [])
        rows = result['opportunities']
        self.assertEqual(rows[0]['record_ids'], ['R1', 'R2'])
        self.assertAlmostEqual(rows[0]['distance_km'], haversine_km((0.1, 0), (0.11, 0)))
        self.assertEqual([r['rank'] for r in rows], [1, 2, 3])
        self.assertTrue(all(r['timeline_overlap'] is None for r in rows))
        self.assertEqual(result, rank_projects([project(3, (0.3, 0)), project(2, (0.11, 0)), a], []))

    def test_shared_substation_is_its_own_category(self):
        row = rank_projects([project(1, (0, 0)), project(2, (0, 0))], [])['opportunities'][0]
        self.assertEqual(row['band'], 'shared_substation')
        self.assertEqual(row['distance_basis'], 'shared_substation_only')
        self.assertIsNone(row['route_intersection'])

    def test_shared_substation_reports_distance_between_other_ends(self):
        hub = {'location': {'type': 'Point', 'coordinates': [0, 0]}}
        a = project(1, (0, 0), destination={'location': {'type': 'Point', 'coordinates': [1, 0]}})
        b = project(2, (0, 0), destination={'location': {'type': 'Point', 'coordinates': [-1, 0]}})
        row = rank_projects([a, b], [])['opportunities'][0]
        self.assertEqual(row['band'], 'shared_substation')
        self.assertEqual(row['distance_basis'], 'other_endpoints')
        self.assertAlmostEqual(row['distance_km'], haversine_km((1, 0), (-1, 0)))
        # Other ends far apart: only the shared-substation base proximity points.
        self.assertEqual(row['score_breakdown']['proximity'], 35)

    def test_long_lines_compared_along_straight_corridor(self):
        a = project(1, (-1, 0), destination={'location': {'type': 'Point', 'coordinates': [1, 0]}})
        b = project(2, (0, -1), destination={'location': {'type': 'Point', 'coordinates': [0, 1]}})
        row = rank_projects([a, b], [])['opportunities'][0]
        self.assertEqual(row['distance_basis'], 'approximate_corridor')
        self.assertEqual(row['distance_km'], 0.0)
        self.assertTrue(row['corridor_crossing'])
        self.assertNotEqual(row['band'], 'touching_crossing')

    def test_segments_of_same_project_pair_are_merged(self):
        rows = [project(1, (0, 0)), project(2, (0.01, 0), project_id='P1'), project(3, (0.02, 0))]
        result = rank_projects(rows, [])
        self.assertEqual(len(result['opportunities']), 1)
        self.assertEqual(result['opportunities'][0]['segment_pairs'], 2)
        self.assertEqual(result['summary']['merged_duplicate_record_pairs'], 1)

    def test_score_uses_in_service_years_and_compatibility(self):
        a = project(1, (0, 0), in_service_year=2030, voltage_max_kv=500.0, project_type='Rebuild')
        b = project(2, (0.2, 0), in_service_year=2031, voltage_max_kv=500.0, project_type='Rebuild; Upgrade')
        row = rank_projects([a, b], [])['opportunities'][0]
        parts = row['score_breakdown']
        self.assertEqual(parts['timeline'], 22.5)
        self.assertEqual(parts['timeline_basis'], 'in_service_year_estimate')
        self.assertEqual(parts['compatibility'], 20)
        self.assertAlmostEqual(row['coordination_score'], round(parts['proximity'] + 22.5 + 20, 1))

    def test_supplied_routes_enable_crossing_tier(self):
        a = project(1, route=route((-1, 0), (1, 0)))
        b = project(2, route=route((0, -1), (0, 1)))
        row = rank_projects([a, b], [])['opportunities'][0]
        self.assertEqual(row['band'], 'touching_crossing')
        self.assertEqual(row['distance_basis'], 'route')

    def test_same_project_inactive_concepts_and_missing_locations(self):
        rows = [project(1, (0, 0)), project(2, (0.01, 0), project_id='P1'),
                project(3, (0, 0), status='Complete'), project(4),
                project(5, (0, 0), dataset_kind='study_concept')]
        result = rank_projects(rows, [])
        self.assertEqual(result['opportunities'], [])
        self.assertEqual(result['summary']['same_project_pairs_skipped'], 1)
        self.assertEqual(len(result['summary']['skipped_records']), 3)
        self.assertGreater(len(rank_projects(rows, [], include_inactive=True, include_concepts=True)['opportunities']), 0)

    def test_snapshot_mixing_rejected(self):
        with self.assertRaises(ValueError):
            rank_projects([project(1, (0, 0)), project(2, (0, 0), source_id='other')], [])

    def test_inputs_unchanged(self):
        rows = [project(1, (0, 0)), project(2, (0.01, 0))]
        original = deepcopy(rows)
        rank_projects(rows, [])
        self.assertEqual(rows, original)


class StorageTests(TestCase):
    def test_stable_ids_and_preserved_workflow(self):
        a, b = ObjectId(), ObjectId()
        self.assertEqual(opportunity_id('s', [a, b]), opportunity_id('s', [b, a]))
        db = MagicMock()
        result = rank_projects([project(1, (0, 0)), project(2, (0, 0))], [])
        save_results(db, 'source', result)
        update = db.coordination_opportunities.bulk_write.call_args.args[0][0]._doc
        for field in ('status', 'status_history', 'timeline_overlap', 'ai_analysis', 'coordination_plan'):
            self.assertNotIn(field, update['$set'])
        self.assertEqual(update['$setOnInsert']['status'], 'detected')
        query = db.coordination_opportunities.update_many.call_args.args[0]
        self.assertEqual(query['source_id'], 'source')
        self.assertEqual(query['generated_by'], 'gridsync_distance_engine')


class EligibilityTimelineTests(TestCase):
    def test_different_utility_rule(self):
        from .eligibility import eligibility
        a = project(1)
        self.assertFalse(eligibility(a, a)['eligible'])
        self.assertTrue(eligibility(a, project(2))['eligible'])
        # Same company in another state is not a cross-utility pair.
        self.assertFalse(eligibility(a, a | {'state_codes': ['SC']})['eligible'])
        self.assertFalse(eligibility({}, {})['eligible'])
        self.assertFalse(eligibility({'owner': 'A, B'}, {'owner': 'B'})['eligible'])

    def test_owner_aliases_and_names_containing_and(self):
        from .eligibility import eligibility
        from .owners import owner_groups
        same = [('Dominion Energy', 'Dominion'), ('Entergy LA', 'Entergy MS'), ('ITC Midwest', 'ITC'),
                ('Southern California Edsion', 'Southern California Edison'), ('NEET', 'NextEra Energy'),
                ('American Transmission Company (ATC)', 'ATC'), ('Pacificorp', 'PacifiCorp')]
        for left, right in same:
            self.assertFalse(eligibility({'owner': left}, {'owner': right})['eligible'], (left, right))
        # "and"/"&" belong to names; they are not co-owner separators.
        self.assertEqual(owner_groups('Pacific Gas and Electric Company (PG&E)'), {'pacific gas and electric company'})
        self.assertTrue(eligibility({'owner': 'Oklahoma Gas and Electric Company'},
                                    {'owner': 'Pacific Gas and Electric Company'})['eligible'])
        self.assertEqual(owner_groups('Grid United, Tuscan Electric'), {'grid united', 'tuscan electric'})

    def test_timeline_requires_intervals(self):
        from .timeline import compare_timelines
        self.assertIsNone(compare_timelines({'in_service_year': 2030}, {'in_service_year': 2030})['overlap'])
        a = {'construction': {'start_date': '2030-01-01', 'end_date': '2030-01-31'}}
        b = {'construction': {'start_date': '2030-01-31', 'end_date': '2030-02-28'}}
        self.assertEqual(compare_timelines(a, b)['overlap_days'], 1)
        b['construction']['start_date'] = '2030-02-01'
        self.assertFalse(compare_timelines(a, b)['overlap'])


class EstimatedTimelineTests(TestCase):
    def test_spending_schedule_window_marks_overlap_estimated(self):
        from .timeline import compare_timelines
        a = {'construction': {'start_date': '2024-01-01', 'end_date': '2025-12-31', 'basis': 'annual_spending_schedule'}}
        b = {'construction': {'start_date': '2024-01-01', 'end_date': '2026-06-01', 'basis': 'ten_year_plan_dates'}}
        result = compare_timelines(a, b)
        self.assertEqual((result['overlap_days'], result['estimated']), (731, True))
        b['construction']['basis'] = a['construction']['basis'] = 'ten_year_plan_dates'
        self.assertFalse(compare_timelines(a, b)['estimated'])
