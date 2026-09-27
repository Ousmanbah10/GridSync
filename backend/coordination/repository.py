"""MongoDB I/O, kept outside all mathematical and matching modules."""
from datetime import datetime, timezone
from hashlib import sha256
from uuid import uuid4
from bson import ObjectId
from pymongo import UpdateOne
from .rules import METHOD_VERSION

GENERATOR = 'gridsync_distance_engine'


def load_snapshot(db, source_id=None):
    sources = db.projects.distinct('source_id')
    if not sources:
        raise ValueError('No imported projects found. Import the Excel workbook first.')
    if source_id is None:
        if len(sources) != 1:
            raise ValueError('Multiple source snapshots found. Choose one with --source-id. IDs: ' + ', '.join(sorted(sources)))
        source_id = sources[0]
    if source_id not in sources:
        raise ValueError('The selected source has no projects.')
    projects = list(db.projects.find({'source_id': source_id}, {'raw_data': 0}))
    substations = list(db.substations.find({'source_id': source_id}, {'raw_data': 0}))
    return source_id, projects, substations


def opportunity_id(source_id, ids):
    # Keyed on the source project pair (not segments), so merged segment/route-option
    # rows keep one stable ID across reruns and preserve workflow/AI notes.
    key = '|'.join([GENERATOR, source_id, *sorted(map(str, ids))])
    return ObjectId(sha256(key.encode()).hexdigest()[:24])


def save_results(db, source_id, result):
    """Single-writer batch upserts. Only generated fields are refreshed."""
    collection = db.coordination_opportunities
    now = datetime.now(timezone.utc)
    run_id = uuid4().hex
    operations = []
    for row in result['opportunities']:
        # Timeline overlap is deliberately unknown in this distance-only engine.
        # Do not erase a subsequent timeline analysis when recalculating distances.
        computed = {key: value for key, value in row.items() if key != 'timeline_overlap'}
        operations.append(UpdateOne({'_id': opportunity_id(source_id, row['project_ids'])}, {
            '$set': computed | {'source_id': source_id, 'generated_by': GENERATOR,
                               'active': True, 'run_id': run_id, 'calculated_at': now, 'updated_at': now},
            '$setOnInsert': {'status': 'detected', 'status_history': [], 'timeline_overlap': None, 'created_at': now},
        }, upsert=True))
    for offset in range(0, len(operations), 250):
        collection.bulk_write(operations[offset:offset + 250], ordered=True)
    # Retire only this engine's older candidates, after all new candidates saved.
    retired = collection.update_many({'generated_by': GENERATOR, 'source_id': source_id,
                                     'run_id': {'$ne': run_id}, 'active': True},
                                    {'$set': {'active': False, 'updated_at': now}}).modified_count
    return {'saved': len(operations), 'retired': retired, 'run_id': run_id, 'method_version': METHOD_VERSION}
