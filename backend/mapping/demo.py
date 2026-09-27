"""Deterministic non-destructive 100-record view, balanced across geography and work types."""
from collections import Counter
from coordination.engine import INACTIVE
from coordination.locations import normalize


def select_demo(projects, opportunities, limit=100):
    candidates = {p['project_record_id']: p for p in projects if p.get('has_location')
                  and normalize(p.get('status')) not in INACTIVE and p.get('dataset_kind') != 'study_concept'}
    chosen, seen_projects = set(), set()
    coverage = {field: Counter() for field in ('state', 'type', 'owner')}
    def group(p):
        return p.get('project_id') or p['project_record_id']
    def diversity(p):
        states = [str(s).upper() for s in p.get('state_codes', [])] or ['Unknown']
        return sum(4 / (1 + coverage['state'][s]) for s in states) / len(states) + 3 / (1 + coverage['type'][p.get('project_type')]) + 1 / (1 + coverage['owner'][p.get('owner')])
    def add(p):
        chosen.add(p['project_record_id']); seen_projects.add(group(p))
        for state in [str(s).upper() for s in p.get('state_codes', [])] or ['Unknown']: coverage['state'][state] += 1
        coverage['type'][p.get('project_type')] += 1
        coverage['owner'][p.get('owner')] += 1
    pairs = [o for o in opportunities if all(i in candidates for i in o['project_record_ids'])]
    # Select diverse connected pairs first so the demo can demonstrate comparisons.
    while pairs and len(chosen) < min(limit, 80):
        options = []
        for pair in pairs:
            new = [candidates[i] for i in pair['project_record_ids'] if i not in chosen]
            if not new or len(chosen) + len(new) > limit or any(group(p) in seen_projects for p in new):
                continue
            if len({group(p) for p in new}) != len(new): continue
            score = sum(diversity(p) for p in new) / len(new)
            options.append((score, -float(pair.get('distance_km') or 0), pair['id'], new))
        if not options: break
        _, _, _, records = max(options, key=lambda x: (x[0], x[1], x[2]))
        for p in records: add(p)
    while len(chosen) < limit:
        remaining = [p for i, p in candidates.items() if i not in chosen and group(p) not in seen_projects]
        if not remaining: break
        add(max(remaining, key=lambda p: (diversity(p), p['project_record_id'])))
    return chosen


def apply_demo(data, limit=100):
    selected = select_demo(data['projects'], data['opportunities'], limit)
    result = dict(data)
    result['projects'] = [p for p in data['projects'] if p['project_record_id'] in selected]
    result['project_locations'] = {'type': 'FeatureCollection', 'features': [f for f in data['project_locations']['features'] if f['properties']['project_record_id'] in selected]}
    result['routes'] = {'type': 'FeatureCollection', 'features': [f for f in data['routes']['features'] if f['properties']['project_record_id'] in selected]}
    result['substations'] = {'type': 'FeatureCollection', 'features': [f for f in data['substations']['features'] if selected.intersection(f['properties']['project_record_ids'])]}
    result['opportunities'] = [o for o in data['opportunities'] if set(o['project_record_ids']).issubset(selected)]
    result['demo'] = {'enabled': True, 'limit': limit, 'total_records': len(data['projects']),
                      'selected_records': len(selected), 'states': sorted({str(s).upper() for p in result['projects'] for s in p.get('state_codes', [])}),
                      'project_types': sorted({p['project_type'] for p in result['projects'] if p.get('project_type')}),
                      'policy': 'Diverse connected pairs, then geographic/type coverage. Full database retained.'}
    return result
