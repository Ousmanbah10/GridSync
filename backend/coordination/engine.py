"""Pure ranking orchestration. Inputs/outputs are ordinary dictionaries."""
from collections import Counter, defaultdict
from itertools import combinations, product
from .geometry import haversine_km, route_distance, route_segments
from .locations import LocationResolver, normalize
from .eligibility import eligibility
from .timeline import compare_timelines
from .rules import METHOD_VERSION, SHARED_SUBSTATION, classify, coordination_score, distance_score

INACTIVE = {'complete', 'completed', 'terminated', 'cancelled', 'canceled'}


def node_key(point):
    # Two records naming the same substation resolve to identical coordinates.
    return (round(point[0], 6), round(point[1], 6))


def prepare(project, resolver, location_issues):
    points, evidence, issues = resolver.resolve(project)
    location_issues.extend({'record_id': project.get('record_id'), **issue} for issue in issues)
    segments = None
    if project.get('route') is not None:
        try:
            segments = route_segments(project['route'])
        except ValueError as exc:
            location_issues.append({'record_id': project.get('record_id'), 'reason': 'invalid_route', 'detail': str(exc)})
    nodes = {}
    for entry in evidence:
        nodes.setdefault(node_key(entry['coordinates']), entry.get('name'))
    ends = {e['role']: tuple(e['coordinates']) for e in evidence if e['role'] in ('origin', 'destination')}
    corridor = None
    if 'origin' in ends and 'destination' in ends and node_key(ends['origin']) != node_key(ends['destination']):
        # Straight line between the two terminal substations: an approximation, not the real route.
        corridor = route_segments({'type': 'LineString', 'coordinates': [list(ends['origin']), list(ends['destination'])]})
    return {'project': project, 'points': points, 'evidence': evidence, 'segments': segments,
            'nodes': nodes, 'corridor': corridor}


def measure(a, b):
    """Return a measurement dict, or None when the pair cannot be compared.

    closest: points drawn/clicked on the map (the shared substation for shared pairs).
    other_ends: for shared pairs, the closest non-shared points that distance_km measures.
    """
    if a['segments'] and b['segments']:
        distance, intersects = route_distance(a['segments'], b['segments'])
        return {'distance': distance, 'basis': 'route', 'closest': None, 'other_ends': None,
                'shared': [], 'route_crossing': intersects, 'corridor_crossing': False}
    if not (a['points'] and b['points']):
        return None
    shared = set(a['nodes']) & set(b['nodes'])
    if shared:
        names = sorted({a['nodes'][k] or b['nodes'][k] or 'Unnamed substation' for k in shared})
        hub = list(next(p for p in a['points'] if node_key(p) in shared))
        other_a = [p for p in a['points'] if node_key(p) not in shared]
        other_b = [p for p in b['points'] if node_key(p) not in shared]
        result = {'distance': 0.0, 'basis': 'shared_substation_only', 'closest': [hub, hub], 'other_ends': None,
                  'shared': names, 'route_crossing': False, 'corridor_crossing': False}
        if other_a and other_b:
            # How far apart the projects are away from the substation they share.
            distance, pa, pb = min((haversine_km(pa, pb), pa, pb) for pa, pb in product(other_a, other_b))
            result |= {'distance': distance, 'basis': 'other_endpoints', 'other_ends': [list(pa), list(pb)]}
        return result
    distance, pa, pb = min((haversine_km(pa, pb), pa, pb) for pa, pb in product(a['points'], b['points']))
    result = {'distance': distance, 'basis': 'substation', 'closest': [list(pa), list(pb)], 'other_ends': None,
              'shared': [], 'route_crossing': False, 'corridor_crossing': False}
    if a['corridor'] and b['corridor']:
        corridor_distance, crossing = route_distance(a['corridor'], b['corridor'])
        if corridor_distance < distance:
            # Map still draws the closest substations; distance_km is the corridor distance.
            result |= {'distance': corridor_distance, 'basis': 'approximate_corridor', 'corridor_crossing': crossing}
    return result


def rank_projects(projects, substations, *, include_inactive=False, include_concepts=False):
    sources = {p.get('source_id') for p in projects}
    if len(sources) > 1:
        raise ValueError('Choose one source snapshot at a time to avoid comparing duplicate versions.')
    if any(p.get('_id') is None or not p.get('project_id') for p in projects):
        raise ValueError('Every project requires a database _id and source project_id.')
    if len({str(p['_id']) for p in projects}) != len(projects):
        raise ValueError('Duplicate project record identifiers.')
    resolver = LocationResolver(substations)
    prepared, skipped, location_issues = [], [], []
    for project in sorted(projects, key=lambda p: str(p['_id'])):
        reason = None
        if not include_concepts and project.get('dataset_kind') == 'study_concept':
            reason = 'study_concept'
        if not include_inactive and normalize(project.get('status')) in INACTIVE:
            reason = 'inactive'
        if reason:
            skipped.append({'record_id': project.get('record_id'), 'reason': reason})
            continue
        item = prepare(project, resolver, location_issues)
        if not item['points'] and not item['segments']:
            skipped.append({'record_id': project.get('record_id'), 'reason': 'no_resolved_location'})
            continue
        prepared.append(item)
    candidates = defaultdict(list)
    compared = incomparable = same_project = ineligible = 0
    for a, b in combinations(prepared, 2):
        left, right = a['project'], b['project']
        if left['project_id'] == right['project_id']:
            same_project += 1
            continue
        pair_eligibility = eligibility(left, right)
        if not pair_eligibility['eligible']:
            ineligible += 1
            continue
        measured = measure(a, b)
        if measured is None:
            incomparable += 1
            continue
        compared += 1
        distance, basis, closest = measured['distance'], measured['basis'], measured['closest']
        shared_names, intersects, corridor_crossing = measured['shared'], measured['route_crossing'], measured['corridor_crossing']
        band = SHARED_SUBSTATION if shared_names else classify(distance, intersects)
        if band is None:
            continue
        timeline = compare_timelines(left, right)
        score, breakdown = coordination_score(left, right, distance, bool(shared_names), timeline,
                                              other_ends_known=basis != 'shared_substation_only')
        owner_relation = 'different_owner_text'
        if shared_names:
            qualification = (f"Both projects connect at {', '.join(shared_names)}. "
                             'Coordinate substation work; the lines themselves may run in different directions.')
        elif basis == 'route':
            qualification = ('Mapped routes touch or cross; verify GIS accuracy and engineering constraints.' if intersects
                             else 'Distance between supplied route geometries.')
        elif basis == 'approximate_corridor':
            qualification = ('Straight-line corridors between terminal substations '
                             + ('cross' if corridor_crossing else 'pass close') + '. Real routes are not in the data; verify.')
        else:
            qualification = 'Closest substations. Shared land/resources and schedule feasibility are not established.'
        candidates[tuple(sorted((left['project_id'], right['project_id'])))].append({
            'project_record_ids': [left['_id'], right['_id']],
            'project_names': [left.get('project_name'), right.get('project_name')],
            'record_ids': [left.get('record_id'), right.get('record_id')],
            'project_ids': [left['project_id'], right['project_id']],
            'owners': [left.get('owner'), right.get('owner')], 'owner_relation': owner_relation,
            'distance_km': distance, 'distance_basis': basis,
            'shared_substations': shared_names,
            'corridor_crossing': corridor_crossing if basis == 'approximate_corridor' else None,
            'distance_score': distance_score(distance),
            'coordination_score': score, 'score_breakdown': breakdown,
            'score_method_version': METHOD_VERSION,
            'band': band['band'], 'priority': band['priority'], 'must_coordinate': band['must_coordinate'],
            'route_intersection': intersects if basis == 'route' else None,
            'closest_substation_coordinates': closest,
            'other_endpoint_coordinates': measured['other_ends'],
            'location_evidence': [a['evidence'], b['evidence']],
            'geometry_sources': [left.get('route_source_url'), right.get('route_source_url')] if basis == 'route' else [],
            'timeline_overlap': None,
            'timeline': timeline, 'eligibility': pair_eligibility,
            'shared_resources': [{'resource': resource, 'source': 'distance_rule',
                'explanation': 'Potential coordination activity; requires engineering and ownership review.'}
                for resource in band['resources']],
            'qualification': qualification,
        })
    order = lambda o: (-o['coordination_score'], o['priority'], o['distance_km'], tuple(map(str, o['project_record_ids'])))
    opportunities = []
    for rows in candidates.values():
        # Segments and alternative route options of the same two projects collapse to one opportunity.
        rows.sort(key=order)
        best = rows[0]
        best['segment_pairs'] = len(rows)
        best['other_record_pairs'] = [row['record_ids'] for row in rows[1:]]
        opportunities.append(best)
    opportunities.sort(key=order)
    for rank, opportunity in enumerate(opportunities, 1):
        opportunity['rank'] = rank
    record_pairs = sum(len(rows) for rows in candidates.values())
    return {'opportunities': opportunities, 'summary': {
        'input_records': len(projects), 'located_records': len(prepared), 'compared_pairs': compared,
        'same_project_pairs_skipped': same_project, 'ineligible_pairs_skipped': ineligible, 'incomparable_pairs': incomparable,
        'record_pairs_before_merge': record_pairs, 'merged_duplicate_record_pairs': record_pairs - len(opportunities),
        'opportunity_count': len(opportunities), 'bands': dict(Counter(o['band'] for o in opportunities)),
        'distance_bases': dict(Counter(o['distance_basis'] for o in opportunities)),
        'skipped_records': skipped, 'location_issues': location_issues,
        'method_version': METHOD_VERSION,
    }}
