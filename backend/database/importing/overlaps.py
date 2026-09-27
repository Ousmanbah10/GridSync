"""Import the 'projects' / 'overlaps' workbook (utility project list with endpoint coordinates).

Each named endpoint with coordinates becomes a substation record, and the project references it,
so the distance engine and map resolve locations exactly as they do for the national workbook.
Blank coordinates stay blank; no location is guessed from a name.
"""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import math
import re
from pymongo import UpdateOne
from bson import ObjectId
from database.schema import setup_database
from .workbook import read_workbook

PROJECT_COLUMNS = {'project_id', 'utility', 'state', 'project_name', 'name_a', 'lat_a', 'lon_a', 'name_b', 'lat_b', 'lon_b'}
REQUIRED_COLUMNS = {'project_id', 'utility', 'project_name'}
STATE_NAMES = {'SC': 'South Carolina', 'GA': 'Georgia'}


def _table(sheet):
    _, header = sheet['rows'][0]
    return [(row, {header[c]: v.strip() for c, v in cells.items() if c in header and v.strip()})
            for row, cells in sheet['rows'][1:]]


def _coordinate(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180:
        return [round(lon, 6), round(lat, 6)]
    return None


def _date(text, date1904):
    if not text:
        return None
    if re.fullmatch(r'\d+(\.\d+)?', text):
        origin = datetime(1904, 1, 1, tzinfo=timezone.utc) if date1904 else datetime(1899, 12, 30, tzinfo=timezone.utc)
        return origin + timedelta(days=float(text))
    match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', text)
    if match:
        month, day, year = map(int, match.groups())
        return datetime(year, month, day, tzinfo=timezone.utc)
    return None


def substation_key(source_id, name, point):
    return ObjectId(sha256(f'{source_id}|{name.casefold()}|{point[0]},{point[1]}'.encode()).hexdigest()[:24])


def build_overlap_import(content, filename):
    sheets, date1904 = read_workbook(content)
    by_name = {sheet['name'].casefold(): sheet for sheet in sheets}
    if 'projects' not in by_name:
        raise ValueError('The workbook needs a "projects" sheet.')
    sheet = by_name['projects']
    header = set(sheet['rows'][0][1].values()) if sheet['rows'] else set()
    if not REQUIRED_COLUMNS.issubset(header):
        raise ValueError('The projects sheet is missing columns: ' + ', '.join(sorted(REQUIRED_COLUMNS - header)))
    rows = _table(sheet)
    digest = sha256(content).hexdigest()
    source_id = 'xlsx:' + digest
    projects, substations, warnings = [], {}, []
    for row, values in rows:
        if not values.get('project_id') or not values.get('project_name'):
            continue
        state = values.get('state', '').upper()
        doc = {'source_id': source_id, 'source_sheet': 'projects', 'source_row': row, 'raw_data': values,
               'dataset_kind': 'planned_project', 'record_id': values['project_id'], 'project_id': values['project_id'],
               'project_name': values['project_name'], 'owner': values.get('utility'),
               'state_codes': [state] if state else [], 'states': [STATE_NAMES[state]] if state in STATE_NAMES else [],
               'source_urls': []}
        voltage = [float(v) for v in re.findall(r'(\d+(?:\.\d+)?)\s*kv', values['project_name'], re.I)]
        doc['voltage_max_kv'] = max(voltage) if voltage else None
        doc['voltage_min_kv'] = min(voltage) if voltage else None
        service = _date(values.get('in_service_date'), date1904)
        if values.get('in_service_date') and not service:
            warnings.append(f'projects, row {row}: unrecognized in_service_date "{values["in_service_date"]}".')
        doc['in_service_date'] = service
        doc['in_service_year'] = service.year if service else None
        doc['in_service_year_raw'] = values.get('in_service_date')
        for side, key in (('a', 'origin'), ('b', 'destination')):
            name = values.get(f'name_{side}')
            point = _coordinate(values.get(f'lat_{side}'), values.get(f'lon_{side}'))
            endpoint = {'name': name or None}
            if name and point:
                sid = substation_key(source_id, name, point)
                substations.setdefault(sid, {'_id': sid, 'source_id': source_id, 'source_sheet': f'projects:name_{side}',
                    'source_row': row, 'substation_id': str(sid), 'name': name, 'state_code': state or None,
                    'state': STATE_NAMES.get(state), 'location': {'type': 'Point', 'coordinates': point},
                    'raw_data': {'name': name, 'lat': values.get(f'lat_{side}'), 'lon': values.get(f'lon_{side}')}})
                endpoint['substation_id'] = sid
            elif name:
                warnings.append(f'projects, row {row}: "{name}" has no coordinates; that endpoint is not mapped.')
            doc[key] = endpoint
        projects.append(doc)
    ids = [p['record_id'] for p in projects]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate project_id values in the projects sheet.')
    reference = []
    if 'overlaps' in by_name:
        for row, values in _table(by_name['overlaps']):
            if values.get('overlap_id'):
                reference.append({'row': row, **values})
    source = {'source_id': source_id, 'name': filename.rsplit('.', 1)[0], 'filename': filename, 'file_sha256': digest,
              'reference_overlaps': reference,
              'note': 'Utility project list with endpoint coordinates. reference_overlaps are the workbook\'s own precomputed pairs.'}
    return {'source': source, 'projects': projects, 'substations': list(substations.values()), 'warnings': warnings}


def import_overlaps(db, data):
    """Insert-only, like the main importer: reruns keep existing records and later enrichments."""
    list(setup_database(db))
    now = datetime.now(timezone.utc)
    db.sources.update_one({'source_id': data['source']['source_id']},
                          {'$setOnInsert': data['source'] | {'created_at': now, 'imported_at': now}}, upsert=True)
    counts = {}
    for collection, docs, key in (('substations', data['substations'], lambda d: {'_id': d['_id']}),
                                  ('projects', data['projects'], lambda d: {'source_id': d['source_id'], 'record_id': d['record_id']})):
        if not docs:
            counts[collection] = {'inserted': 0, 'existing': 0}
            continue
        result = db[collection].bulk_write([UpdateOne(key(d), {'$setOnInsert': d | {'created_at': now, 'updated_at': now}}, upsert=True)
                                            for d in docs], ordered=True)
        counts[collection] = {'inserted': result.upserted_count, 'existing': len(docs) - result.upserted_count}
    return counts
