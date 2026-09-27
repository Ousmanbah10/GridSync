"""Join map locations to project records without inventing transmission routes."""
from collections import defaultdict
from coordination.locations import LocationResolver
from .geojson import substations_geojson
from coordination.eligibility import eligibility
from coordination.timeline import compare_timelines


def build_overview(projects, substations, opportunities):
    resolver = LocationResolver(substations)
    associations = defaultdict(set)
    features, records, routes = [], [], []
    for project in projects:
        record_id = str(project['_id'])
        points, evidence, _ = resolver.resolve(project)
        properties = {key: project.get(key) for key in ('project_name', 'owner', 'project_type',
                       'status', 'in_service_year', 'record_id', 'project_id', 'dataset_kind')}
        properties['project_record_id'] = record_id
        records.append(properties | {'has_location': bool(points), 'state_codes': project.get('state_codes', []),
            'states': project.get('states', []), 'construction': project.get('construction'),
            'project_cost': project.get('project_cost'), 'origin': (project.get('origin') or {}).get('name'),
            'destination': (project.get('destination') or {}).get('name'), 'voltage_min_kv': project.get('voltage_min_kv'),
            'voltage_max_kv': project.get('voltage_max_kv'), 'source_urls': project.get('source_urls', []),
            'source_sheet': project.get('source_sheet'), 'source_row': project.get('source_row'),
            'project_cost_note': project.get('project_cost_note'), 'in_service_date': project.get('in_service_date'),
            'document_status': project.get('document_status')})
        for entry in evidence:
            if entry.get('substation_id'):
                associations[entry['substation_id']].add(record_id)
        for index, point in enumerate(points):
            features.append({'type': 'Feature', 'id': f'{record_id}:{index}',
                             'geometry': {'type': 'Point', 'coordinates': list(point)}, 'properties': properties})
        if project.get('route'):
            routes.append({'type': 'Feature', 'id': record_id, 'geometry': project['route'], 'properties': properties})
    stations = substations_geojson(substations)
    for feature in stations['features']:
        feature['properties']['project_record_ids'] = sorted(associations[feature['id']])
    cleaned = []
    by_id = {str(p["_id"]): p for p in projects}
    valid_ids = {str(p['_id']) for p in projects}
    for opportunity in opportunities:
        ids = list(map(str, opportunity.get('project_record_ids', [])))
        if len(ids) != 2 or not set(ids).issubset(valid_ids):
            continue
        pair_eligibility = eligibility(by_id[ids[0]], by_id[ids[1]])
        if not pair_eligibility["eligible"]:
            continue
        timeline = compare_timelines(by_id[ids[0]], by_id[ids[1]])
        row = {key: opportunity.get(key) for key in ('project_names', 'owners', 'record_ids', 'distance_km',
               'distance_basis', 'band', 'priority', 'rank', 'distance_score', 'coordination_score', 'score_breakdown',
               'shared_substations', 'corridor_crossing', 'segment_pairs', 'other_record_pairs', 'timeline_overlap',
               'closest_substation_coordinates', 'other_endpoint_coordinates', 'shared_resources', 'status', 'qualification')}
        cleaned.append(row | {'id': str(opportunity['_id']), 'project_record_ids': ids, 'timeline': timeline,
                              'timeline_overlap': timeline['overlap'], 'eligibility': pair_eligibility,
                              'in_service_years': [by_id[i].get('in_service_year') for i in ids]})
    return {'projects': records, 'project_locations': {'type': 'FeatureCollection', 'features': features},
            'substations': stations, 'routes': {'type': 'FeatureCollection', 'features': routes},
            'opportunities': cleaned}
