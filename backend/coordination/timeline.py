"""Construction overlap is calculated only from complete, valid date intervals."""
from datetime import date, datetime


def as_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
    return None


def compare_timelines(left, right):
    intervals = []
    for project in (left, right):
        construction = project.get('construction') or {}
        start, end = as_date(construction.get('start_date')), as_date(construction.get('end_date'))
        if not start or not end:
            return {'status': 'unknown', 'overlap': None, 'overlap_days': None,
                    'reason': 'Complete construction start and end dates are not available for both projects.'}
        if end < start:
            return {'status': 'invalid', 'overlap': None, 'overlap_days': None,
                    'reason': 'A construction end date is earlier than its start date.'}
        intervals.append((start, end))
    start, end = max(i[0] for i in intervals), min(i[1] for i in intervals)
    days = max(0, (end - start).days + 1)
    return {'status': 'overlap' if days else 'no_overlap', 'overlap': bool(days), 'overlap_days': days,
            'start_date': start.isoformat() if days else None, 'end_date': end.isoformat() if days else None,
            'reason': 'Inclusive intersection of documented construction intervals.'}
