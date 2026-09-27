from django.http import JsonResponse
from django.views.decorators.http import require_GET
from database.views import local_api
from database.mongo import get_database
from .geojson import substations_geojson


@require_GET
@local_api
def substations(request):
    query = {}
    if request.GET.get('source_id'):
        query['source_id'] = request.GET['source_id']
    fields = {name: 1 for name in ('name', 'substation_id', 'state_code', 'voltage_max_kv',
                                   'existing_or_new', 'source_id', 'source_sheet', 'source_row', 'location')}
    return JsonResponse(substations_geojson(get_database().substations.find(query, fields)))


@require_GET
@local_api
def overview(request):
    from coordination.repository import GENERATOR
    from .overview import build_overview
    db = get_database()
    available = db.projects.distinct('source_id')
    metadata = list(db.sources.find({'source_id': {'$in': available}}, {'source_id': 1, 'filename': 1}).sort('imported_at', -1))
    sources = [{'id': s['source_id'], 'name': s.get('filename') or s['source_id']} for s in metadata]
    known = {s['id'] for s in sources}
    sources.extend({'id': s, 'name': s} for s in sorted(available) if s not in known)
    selected = request.GET.get('source_id') or (sources[0]['id'] if sources else None)
    if selected and selected not in available:
        raise ValueError('Unknown source snapshot.')
    query = {'source_id': selected}
    projects = list(db.projects.find(query, {'raw_data': 0})) if selected else []
    stations = list(db.substations.find(query, {'raw_data': 0})) if selected else []
    opportunities = list(db.coordination_opportunities.find(
        query | {'generated_by': GENERATOR, 'active': True},
        {'location_evidence': 0, 'ai_analysis': 0, 'coordination_plan': 0, 'meeting_agenda': 0}
    ).sort([('distance_km', 1), ('priority', 1), ('_id', 1)])) if selected else []
    data = build_overview(projects, stations, opportunities)
    if request.GET.get('scope', 'demo') == 'demo':
        from .demo import apply_demo
        data = apply_demo(data)
    else:
        data['demo'] = {'enabled': False, 'total_records': len(projects)}
    return JsonResponse(data | {'sources': sources, 'source_id': selected})
