"""Deterministic extraction from utility planning documents, with page citations.

Supported formats:
- Dominion Energy South Carolina "Planned Transmission Projects $2M and above" descriptions.
- Georgia ITS Ten-Year Plan project sheets (Georgia Power IRP, public disclosure volume).

Only fields printed in the public document are read. REDACTED values stay unknown.
"""
import re
import unicodedata
from datetime import datetime, timezone

DATE = r'(\d{1,2})/(\d{1,2})/(\d{2,4})'
MONEY = re.compile(r'\$\s?([\d,]+(?:\.\d+)?)')


def normalize_title(text):
    """Punctuation- and spacing-insensitive key: '115 kV / LR' == '115kV/LR'."""
    text = unicodedata.normalize('NFKC', str(text or '')).casefold()
    return re.sub(r'[^a-z0-9]+', '', text)


def parse_date(month, day, year):
    year = int(year)
    if year < 100:
        year += 2000
    return datetime(year, int(month), int(day), tzinfo=timezone.utc)


def _lines(page_text):
    return [line.strip() for line in page_text.splitlines() if line.strip()]


def _after(lines, label):
    for index, line in enumerate(lines):
        if line.casefold().startswith(label.casefold()):
            return index
    return None


def parse_dominion(pages, document):
    """pages: list of page texts (index 0 = page 1). One project per page in this format."""
    projects = []
    for number, text in enumerate(pages, 1):
        lines = _lines(text)
        pid = _after(lines, 'Project ID')
        if pid is None or pid == 0:
            continue
        start = next((i for i, line in enumerate(lines[:pid]) if line.startswith('Planned Transmission Projects')), None)
        title_lines = [line for line in lines[(start + 1 if start is not None else 0):pid]
                       if not re.match(r'^(Project \d+ of \d+|Dominion Energy South Carolina|\d+ Year Budget$)', line)]
        title = ' '.join(title_lines).strip()
        if not title:
            continue
        section = lambda label, stop: ' '.join(lines[_after(lines, label) + 1:_after(lines, stop)]) \
            if _after(lines, label) is not None and _after(lines, stop) is not None else None
        entry = {'title': title, 'key': normalize_title(title), 'page': number, 'document': document,
                 'utility_project_id': lines[pid + 1] if pid + 1 < len(lines) else None,
                 'description': section('Project Description', 'Project Need'),
                 'need': section('Project Need', 'Project Status'),
                 'status': section('Project Status', 'Planned In-Service Date'),
                 'in_service_date': None, 'cost': None}
        isd = _after(lines, 'Planned In-Service Date')
        if isd is not None and isd + 1 < len(lines):
            match = re.search(DATE, lines[isd + 1])
            if match:
                entry['in_service_date'] = parse_date(*match.groups())
        header = _after(lines, 'Previous 2024')
        if header is not None:
            columns = lines[header].split()
            amounts = []
            for line in lines[header + 1:]:
                if line.startswith('*') or line.startswith('<<'):
                    break
                amounts += [float(value.replace(',', '')) for value in MONEY.findall(line)]
            # Previous, one amount per listed year, then Total. Keep the printed total either way,
            # but flag documents whose yearly amounts do not add up to it.
            if len(amounts) == len(columns):
                entry['cost'] = {'total': amounts[-1], 'by_period': dict(zip(columns[:-1], amounts[:-1])),
                                 'components_match': abs(sum(amounts[:-1]) - amounts[-1]) < 1}
        projects.append(entry)
    return projects


def parse_georgia(pages, document):
    """Georgia ITS Ten-Year Plan project sheets: title, Teams #, need date, start date, description."""
    projects = []
    for number, text in enumerate(pages, 1):
        lines = _lines(text)
        teams = next((i for i, line in enumerate(lines) if line.startswith('Teams #')), None)
        if teams is None or teams == 0:
            continue
        dates = re.search(rf'Need Date\s+{DATE}\s+Start Date\s+{DATE}', ' '.join(lines[teams:teams + 3]))
        if not dates:
            continue
        values = dates.groups()
        note = _after(lines, '* The ITS Assigned')
        stop = next((i for i in range(note + 1, len(lines)) if lines[i] == 'REDACTED'), None) if note is not None else None
        description = ' '.join(lines[note + 1:stop]) if note is not None and stop is not None else None
        title = lines[teams - 1]
        end = next((i for i in range(stop + 1, len(lines)) if lines[i].startswith('PUBLIC DISCLOSURE')), len(lines)) if stop is not None else None
        changes = parse_changes(lines[stop + 1:end]) if stop is not None else []
        projects.append({'title': title, 'key': normalize_title(title), 'page': number, 'document': document,
                         'schedule_changes': changes,
                         'utility_project_id': lines[teams].replace('Teams #', '').strip(),
                         'need_date': parse_date(*values[:3]), 'start_date': parse_date(*values[3:]),
                         'description': description, 'cost_redacted': 'REDACTED' in text})
    return projects


CHANGE_BASES = ('previous Ten-Year Plan', 'previous IRP')


def classify_change(text):
    """'Project delayed from 2024 to 2027' -> {'kind': 'delayed', 'from_year': 2024, 'to_year': 2027, ...}."""
    clean = ' '.join(text.split())
    moved = re.search(r'(delayed|advanced) from (\d{4}) to (\d{4})', clean, re.I)
    if moved:
        return {'kind': moved.group(1).lower(), 'from_year': int(moved.group(2)), 'to_year': int(moved.group(3)), 'text': clean}
    advanced_in = re.search(r'advanced in (\d{4})', clean, re.I)
    if advanced_in:
        return {'kind': 'advanced', 'from_year': None, 'to_year': int(advanced_in.group(1)), 'text': clean}
    lowered = clean.casefold()
    kind = 'delayed' if 'delay' in lowered else 'new' if 'new project' in lowered else 'none' if lowered == 'no change' else 'other'
    return {'kind': kind, 'from_year': None, 'to_year': None, 'text': clean}


def parse_changes(lines):
    """The two change fields print in order: vs the previous Ten-Year Plan, then vs the previous IRP."""
    if len(lines) != len(CHANGE_BASES):
        return [{'compared_to': 'previous plan', **classify_change(' '.join(lines))}] if lines else []
    return [{'compared_to': basis, **classify_change(line)} for basis, line in zip(CHANGE_BASES, lines)]


def delay_summary(changes):
    """Headline for a project: the largest documented delay, else an advance, else None."""
    moved = [c for c in changes if c['kind'] in ('delayed', 'advanced')]
    if not moved:
        return None
    delays = [c for c in moved if c['kind'] == 'delayed']
    pick = max(delays, key=lambda c: (c['to_year'] or 0) - (c['from_year'] or 0)) if delays else moved[0]
    years = (pick['to_year'] - pick['from_year']) if pick['from_year'] and pick['to_year'] else None
    return {'kind': pick['kind'], 'from_year': pick['from_year'], 'to_year': pick['to_year'], 'years': years,
            'compared_to': pick['compared_to'], 'text': pick['text']}


def index_by_title(entries):
    """Title key -> entry; titles that appear more than once are ambiguous and dropped."""
    seen, result = set(), {}
    for entry in entries:
        if entry['key'] in seen:
            result.pop(entry['key'], None)
            continue
        seen.add(entry['key'])
        result[entry['key']] = entry
    return result


def dominion_enrichment(entry):
    """Update for a project from a Dominion entry. Construction window is an estimate from the spending schedule."""
    update, evidence = {}, []
    cite = {'document': entry['document'], 'page': entry['page'], 'utility_project_id': entry['utility_project_id']}
    if entry['cost']:
        update['project_cost'] = {'amount': entry['cost']['total'], 'currency': 'USD',
                                  'basis': 'Total estimated project cost', 'by_period': entry['cost']['by_period'], **cite}
        if not entry['cost']['components_match']:
            update['project_cost']['note'] = 'Yearly amounts in the document do not add up to the printed total.'
        evidence.append({'field': 'project_cost', 'value': f"${entry['cost']['total']:,.0f}", **cite})
    years = sorted(int(k) for k, v in (entry['cost'] or {}).get('by_period', {}).items() if k.isdigit() and v > 0)
    if years and entry['in_service_date']:
        start = datetime(years[0], 1, 1, tzinfo=timezone.utc)
        end = max(entry['in_service_date'], datetime(years[-1], 12, 31, tzinfo=timezone.utc))
        earlier = (entry['cost']['by_period'].get('Previous') or 0) > 0
        update['construction'] = {'start_date': start, 'end_date': end, 'basis': 'annual_spending_schedule',
                                  'note': 'Estimated from the published annual spending schedule'
                                          + ('; spending also occurred before 2024.' if earlier else '.'), **cite}
        evidence.append({'field': 'construction', 'value': f'{start:%Y-%m-%d} to {end:%Y-%m-%d} (estimated)', **cite})
    if entry['in_service_date']:
        update['in_service_date'] = entry['in_service_date']
        evidence.append({'field': 'in_service_date', 'value': f"{entry['in_service_date']:%Y-%m-%d}", **cite})
    for field in ('status', 'description', 'need'):
        if entry.get(field):
            update[f'document_{field}'] = entry[field]
    return update, evidence


def georgia_enrichment(entry):
    cite = {'document': entry['document'], 'page': entry['page'], 'utility_project_id': entry['utility_project_id']}
    update = {'construction': {'start_date': entry['start_date'], 'end_date': entry['need_date'],
                               'basis': 'ten_year_plan_dates',
                               'note': 'Project start date and need (in-service) date from the Ten-Year Plan.', **cite},
              'in_service_date': entry['need_date']}
    evidence = [{'field': 'construction', 'value': f"{entry['start_date']:%Y-%m-%d} to {entry['need_date']:%Y-%m-%d}", **cite}]
    if entry.get('description'):
        update['document_description'] = entry['description']
    if entry.get('schedule_changes'):
        update['schedule_changes'] = entry['schedule_changes']
        flag = delay_summary(entry['schedule_changes'])
        if flag:
            update['schedule_flag'] = flag
            evidence.append({'field': 'schedule_change', 'value': flag['text'] + f" (vs. {flag['compared_to']})", **cite})
    if entry.get('cost_redacted'):
        update['project_cost_note'] = 'Estimated cost is redacted in the public filing.'
        evidence.append({'field': 'project_cost', 'value': 'Redacted in public filing', **cite})
    return update, evidence
