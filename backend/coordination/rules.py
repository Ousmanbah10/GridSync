"""All business thresholds and score weights live here. Upper distance bounds are exclusive."""
from math import isfinite

METHOD_VERSION = 'coordination-v4-miles'
# Thresholds are set in miles (the challenge rule is "within 25 miles"); distances are stored in km.
KM_PER_MILE = 1.609344
MAX_DISTANCE_MI = 25.0
MAX_DISTANCE_KM = MAX_DISTANCE_MI * KM_PER_MILE
BANDS = (
    (1 * KM_PER_MILE, 'shared_land', 2, ('right-of-way', 'access roads', 'permits')),
    (5 * KM_PER_MILE, 'shared_logistics', 3, ('laydown yards', 'deliveries')),
    (MAX_DISTANCE_KM, 'shared_crews_equipment', 4, ('crews', 'equipment')),
)


def miles(distance_km):
    return distance_km / KM_PER_MILE
SHARED_SUBSTATION = {'band': 'shared_substation', 'priority': 1, 'must_coordinate': True,
                     'resources': ['substation outage/switching plan', 'bay and yard space', 'protection settings']}

# Score weights (total 100). Keep them explainable; every point is itemized.
PROXIMITY_POINTS = 50
# A shared substation earns this base; the rest depends on how close the other ends are.
SHARED_SUBSTATION_BASE = 35
TIMELINE_POINTS = 30
COMPATIBILITY_POINTS = 20
# In-service-year gap (years) -> share of timeline points. Estimated, not construction dates.
YEAR_GAP_SHARE = {0: 1.0, 1: 0.75, 2: 0.5, 3: 0.25}


def classify(distance_km, route_intersection=False):
    if not isfinite(distance_km) or distance_km < 0:
        raise ValueError('Distance must be finite and nonnegative.')
    if route_intersection:
        if distance_km != 0:
            raise ValueError('Intersecting routes must have zero distance.')
        return {'band': 'touching_crossing', 'priority': 0, 'must_coordinate': True,
                'resources': ['outage timing', 'crossing structures']}
    for limit, name, priority, resources in BANDS:
        if distance_km < limit:
            return {'band': name, 'priority': priority, 'must_coordinate': False,
                    'resources': list(resources)}
    return None


def distance_score(distance_km):
    """Transparent proximity-only score, 0-100."""
    if not isfinite(distance_km) or distance_km < 0:
        raise ValueError('Distance must be finite and nonnegative.')
    return max(0.0, 100.0 * (1.0 - distance_km / MAX_DISTANCE_KM))


def work_types(project):
    return {part.strip().casefold() for part in str(project.get('project_type') or '').split(';') if part.strip()}


def coordination_score(left, right, distance_km, shared_substation, timeline, other_ends_known=True):
    """Itemized 0-100 score: proximity + timeline + compatibility."""
    parts, notes = {}, []
    if shared_substation:
        extra = (PROXIMITY_POINTS - SHARED_SUBSTATION_BASE) * distance_score(distance_km) / 100 if other_ends_known else 0
        parts['proximity'] = SHARED_SUBSTATION_BASE + extra
        notes.append('Shares a substation.' + (f' Other ends {miles(distance_km):.1f} mi apart.' if other_ends_known
                                               else ' Other ends not mapped.'))
    else:
        parts['proximity'] = PROXIMITY_POINTS * distance_score(distance_km) / 100
        notes.append(f'{miles(distance_km):.1f} mi apart.')

    if timeline.get('overlap') is not None:
        parts['timeline'] = TIMELINE_POINTS if timeline['overlap'] else 0
        parts['timeline_basis'] = 'illustrative' if timeline.get('illustrative') else 'construction_estimate' if timeline.get('estimated') else 'construction_dates'
        label = 'Illustrative construction windows' if timeline.get('illustrative') else 'Estimated construction windows' if timeline.get('estimated') else 'Construction dates'
        notes.append(f'{label} overlap by {timeline["overlap_days"]} days.' if timeline['overlap'] else f'{label} do not overlap.')
    else:
        ya, yb = left.get('in_service_year'), right.get('in_service_year')
        if ya and yb:
            gap = abs(ya - yb)
            parts['timeline'] = TIMELINE_POINTS * YEAR_GAP_SHARE.get(gap, 0)
            parts['timeline_basis'] = 'in_service_year_estimate'
            notes.append(f'In-service years {ya} and {yb} ({gap} yr apart; estimate only).')
        else:
            parts['timeline'] = 0
            parts['timeline_basis'] = 'unknown'
            notes.append('Timeline unknown: no in-service year for both projects.')

    compat = 0
    va, vb = left.get('voltage_max_kv'), right.get('voltage_max_kv')
    if va and vb and va == vb:
        compat += COMPATIBILITY_POINTS / 2
        notes.append(f'Same voltage ({va:g} kV).')
    if work_types(left) & work_types(right):
        compat += COMPATIBILITY_POINTS / 2
        notes.append('Same work type.')
    parts['compatibility'] = compat
    total = round(parts['proximity'] + parts['timeline'] + parts['compatibility'], 1)
    return total, {**{k: (round(v, 1) if isinstance(v, float) else v) for k, v in parts.items()}, 'notes': notes}
