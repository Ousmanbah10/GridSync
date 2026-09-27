"""Pair eligibility: the two records must belong to different recorded utilities."""
from .owners import UNKNOWN, owner_groups


def owner_names(value):
    return owner_groups(value)


def eligibility(left, right):
    a, b = owner_groups(left.get('owner')), owner_groups(right.get('owner'))
    states_a = {str(s).strip().upper() for s in left.get('state_codes', []) if str(s).strip().lower() not in UNKNOWN}
    states_b = {str(s).strip().upper() for s in right.get('state_codes', []) if str(s).strip().lower() not in UNKNOWN}
    different_companies = bool(a and b and a.isdisjoint(b))
    return {'eligible': different_companies,
            'different_companies': different_companies,
            'different_states': bool(states_a and states_b and states_a.isdisjoint(states_b)),
            'owner_groups': [sorted(a), sorted(b)],
            'basis': 'Different recorded utilities after alias grouping (coordination/owners.py). '
                     'Same company in different states is not a cross-utility pair.'}
