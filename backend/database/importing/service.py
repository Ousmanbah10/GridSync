from collections import Counter
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import math
import re
from pymongo import UpdateOne

from database.schema import setup_database
from .workbook import read_workbook
from .mapping import get_mapping, REQUIRED

SHEETS = {'Planned Transmission Projects': ('projects', 'planned_project'),
          'Study Concepts': ('projects', 'study_concept'),
          'Substations in Planned Projects': ('substations', None)}
NUMBERS = {'voltage_min_kv', 'voltage_max_kv', 'capacity_mw', 'length_miles', 'planned_voltage_kv'}
LISTS = {'states', 'state_codes', 'rtos', 'related_substations'}
SPECIAL = {'origin', 'destination', 'in_service_year', 'status_updated_at', 'permitting_updated_at',
           'latitude', 'longitude', 'link1', 'link2', 'federal_status', 'state_status',
           'federal_simple_status', 'state_simple_status'}


def build_preview(content, filename, use_ai=False):
    sheets, date1904 = read_workbook(content)
    digest = sha256(content).hexdigest()
    source_id = 'xlsx:' + digest
    documents = {'projects': [], 'substations': []}
    warnings, errors, summaries, mappings = [], [], [], []
    def issue(sheet, row, field, message):
        warnings.append(f'{sheet}, row {row}: {field} — {message}')
    for sheet in sheets:
        if sheet['name'] not in SHEETS:
            continue
        collection, kind = SHEETS[sheet['name']]
        if len(sheet['rows']) < 2:
            continue
        _, header_cells = sheet['rows'][0]
        headers = list(header_cells.values())
        if len(headers) != len(set(headers)):
            errors.append(f'{sheet["name"]}: duplicate column headings.'); continue
        mapping = get_mapping(headers, collection, use_ai)
        mappings.append({'sheet': sheet['name'], 'fields': mapping,
                         'unmapped_columns': [h for h in headers if h not in mapping.values()]})
        if sheet['formulas']:
            warnings.append(f'{sheet["name"]}: {sheet["formulas"]} formula cells use saved Excel results. Recalculate in Excel if needed.')
        start = len(documents[collection])
        for row_number, cells in sheet['rows'][1:]:
            raw = {label: cells.get(column, '') for column, label in header_cells.items()}
            values = {field: raw[column] for field, column in mapping.items()}
            if not any(values.values()):
                continue
            missing = [field for field in REQUIRED[collection] if not values.get(field)]
            if missing:
                errors.append(f'{sheet["name"]}, row {row_number}: missing {", ".join(missing)}.'); continue
            doc = {'source_id': source_id, 'source_sheet': sheet['name'], 'source_row': row_number,
                   'raw_data': raw}
            if kind:
                doc['dataset_kind'] = kind
            def number(field, nonnegative=True):
                text = values.get(field, '')
                if text.casefold() in ('', 'unknown', 'n/a', 'na', 'tbd', 'none'):
                    return None
                try:
                    value = float(text)
                    if not math.isfinite(value) or (nonnegative and value < 0):
                        raise ValueError()
                    return value
                except ValueError:
                    issue(sheet['name'], row_number, field, 'not a valid number; kept in original data')
                    return None
            def date(field):
                text = values.get(field, '')
                if not text:
                    return None
                try:
                    if re.fullmatch(r'\d+(\.\d+)?', text):
                        value = float(text)
                        if not 1 <= value <= 150000:
                            raise ValueError()
                        return datetime(1904, 1, 1, tzinfo=timezone.utc) + timedelta(days=value) if date1904 else datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=value)
                    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
                except (ValueError, OverflowError):
                    issue(sheet['name'], row_number, field, 'unrecognized date; kept in original data')
                    return None
            for field, value in values.items():
                if field in NUMBERS:
                    doc[field] = number(field)
                    if doc[field] == 0 and field != 'length_miles':
                        doc[field] = None
                        issue(sheet['name'], row_number, field, 'source says 0; treated as unknown, original retained')
                elif field in LISTS:
                    doc[field] = [part.strip() for part in value.split(',') if part.strip()]
                elif field not in SPECIAL:
                    doc[field] = value or None
            if collection == 'projects':
                doc['origin'] = {'name': values.get('origin') or None}
                doc['destination'] = {'name': values.get('destination') or None}
                doc['in_service_year_raw'] = values.get('in_service_year') or None
                year = values.get('in_service_year', '')
                doc['in_service_year'] = int(year) if re.fullmatch(r'\d{4}', year) and 1900 <= int(year) <= 2200 else None
                if year and doc['in_service_year'] is None:
                    issue(sheet['name'], row_number, 'in_service_year', 'uncertain year retained as text')
                doc['status_updated_at'] = date('status_updated_at')
                doc['permitting'] = {key: values.get(key) or None for key in
                    ('federal_status', 'state_status', 'federal_simple_status', 'state_simple_status')}
                doc['permitting']['updated_at'] = date('permitting_updated_at')
                doc['source_urls'] = []
                for key in ('link1', 'link2'):
                    url = values.get(key, '')
                    if url.startswith(('https://', 'http://')):
                        doc['source_urls'].append(url)
                    elif url:
                        issue(sheet['name'], row_number, key, 'not an HTTP link; kept in original data')
            else:
                lat, lon = number('latitude', False), number('longitude', False)
                if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
                    doc['location'] = {'type': 'Point', 'coordinates': [lon, lat]}
                else:
                    issue(sheet['name'], row_number, 'location', 'missing or invalid coordinates; location omitted')
            documents[collection].append(doc)
        summaries.append({'sheet': sheet['name'], 'collection': collection,
                          'count': len(documents[collection]) - start})
    if not summaries:
        raise ValueError('No supported sheets found. Use the Our Grid Future workbook with its original sheet names.')
    for record_id, count in Counter(d['record_id'] for d in documents['projects']).items():
        if count > 1:
            errors.append(f'Duplicate project Record ID {record_id}. Resolve it before importing.')
    for sub_id, count in Counter(d['substation_id'] for d in documents['substations']).items():
        if count > 1:
            warnings.append(f'Substation ID {sub_id} appears {count} times. All source rows will be preserved for review.')
    warnings.append('Route geometry, construction dates, and project costs are not supplied by this workbook. They remain empty.')
    source = {'source_id': source_id, 'name': filename.rsplit('.', 1)[0], 'filename': filename,
              'file_sha256': digest}
    # Preserve attribution from the workbook, without assuming who created an arbitrary upload.
    about = next((s for s in sheets if s['name'] == 'About'), None)
    if about:
        source['raw_about'] = [{ 'row': row, 'cells': cells} for row, cells in about['rows']]
        for _, cells in about['rows']:
            for text in cells.values():
                if 'Planned Transmission Projects National Database' in text and 'Abramson' in text:
                    source['citation'] = text
    return {'filename': filename, 'source': source, 'documents': documents, 'sheets': summaries,
            'mappings': mappings, 'warnings': warnings, 'errors': errors,
            'mode': 'gemini' if use_ai else 'standard'}


def public_preview(preview):
    return {key: preview[key] for key in ('filename', 'sheets', 'mappings', 'mode', 'errors')} | {
        'warning_count': len(preview['warnings']), 'warnings': preview['warnings'],
        'counts': {name: len(rows) for name, rows in preview['documents'].items()},
        'records': {name: [{k: v for k, v in doc.items() if k not in ('raw_data', 'source_id')}
                           for doc in rows] for name, rows in preview['documents'].items()},
    }


def import_preview(db, preview):
    if preview['errors']:
        raise ValueError('Resolve the preview errors before importing.')
    list(setup_database(db))
    now = datetime.now(timezone.utc)
    # Insert-only: retries keep existing records and never overwrite later enrichments.
    source = preview['source'] | {'created_at': now, 'imported_at': now,
                                   'import_mode': preview['mode'], 'column_mappings': preview['mappings']}
    db.sources.update_one({'source_id': source['source_id']}, {'$setOnInsert': source}, upsert=True)
    counts = {}
    for collection, documents in preview['documents'].items():
        operations = []
        for doc in documents:
            key = {'source_id': doc['source_id']}
            key.update({'record_id': doc['record_id']} if collection == 'projects' else
                       {'source_sheet': doc['source_sheet'], 'source_row': doc['source_row']})
            operations.append(UpdateOne(key, {'$setOnInsert': doc | {'created_at': now, 'updated_at': now}}, upsert=True))
        inserted = 0
        for start in range(0, len(operations), 250):
            result = db[collection].bulk_write(operations[start:start + 250], ordered=True)
            inserted += result.upserted_count
        counts[collection] = {'inserted': inserted, 'existing': len(documents) - inserted}
    return counts
