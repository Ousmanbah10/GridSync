"""Conservative source-scoped matching. No fuzzy names or invented routes."""
from collections import defaultdict
import unicodedata
from .geometry import coordinate


def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', str(text or '')).casefold().split())


def point_from(geometry):
    if not isinstance(geometry, dict) or geometry.get('type') != 'Point':
        return None
    try:
        return coordinate(geometry.get('coordinates'))
    except ValueError:
        return None


class LocationResolver:
    def __init__(self, substations):
        self.by_id = {str(s['_id']): s for s in substations if s.get('_id') is not None}
        self.by_name = defaultdict(list)
        for substation in substations:
            self.by_name[(substation.get('source_id'), normalize(substation.get('name')))].append(substation)

    def resolve(self, project):
        points, evidence, issues = [], [], []
        entries = [(key, project.get(key) or {}) for key in ('origin', 'destination')]
        entries.extend(('related', {'name': name}) for name in project.get('related_substations', []))
        for role, endpoint in entries:
            direct = point_from(endpoint.get('location'))
            if direct is not None:
                points.append(direct)
                evidence.append({'role': role, 'name': endpoint.get('name'), 'method': 'explicit_location', 'coordinates': list(direct)})
                continue
            ref = endpoint.get('substation_id')
            if ref is not None:
                matched = self.by_id.get(str(ref))
                candidates = [matched] if matched is not None else []
                method = 'explicit_substation_reference'
            else:
                name = normalize(endpoint.get('name'))
                if not name:
                    continue
                candidates = self.by_name[(project.get('source_id'), name)]
                states = {normalize(s) for s in project.get('state_codes', [])}
                candidates = [s for s in candidates if states and normalize(s.get('state_code')) in states]
                method = 'exact_name_and_project_state'
            if len(candidates) != 1:
                issues.append({'role': role, 'name': endpoint.get('name'),
                               'reason': 'ambiguous' if candidates else 'unmatched'})
                continue
            point = point_from(candidates[0].get('location'))
            if point is None:
                issues.append({'role': role, 'name': endpoint.get('name'), 'reason': 'invalid_coordinates'})
                continue
            points.append(point)
            evidence.append({'role': role, 'name': endpoint.get('name'), 'method': method,
                             'substation_id': str(candidates[0].get('_id', candidates[0].get('substation_id'))),
                             'coordinates': list(point)})
        return list(dict.fromkeys(points)), evidence, issues
