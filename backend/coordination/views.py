"""Read-only API for the future frontend. Reuses the current local API boundary."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from database.views import local_api
from database.mongo import get_database
from .repository import GENERATOR


@require_GET
@local_api
def opportunities(request):
    limit = max(1, min(200, int(request.GET.get('limit', '50'))))
    offset = max(0, int(request.GET.get('offset', '0')))
    query = {'generated_by': GENERATOR, 'active': True}
    if request.GET.get('source_id'):
        query['source_id'] = request.GET['source_id']
    collection = get_database().coordination_opportunities
    rows = list(collection.find(query).sort([('distance_km', 1), ('priority', 1), ('_id', 1)]).skip(offset).limit(limit))
    for row in rows:
        row['_id'] = str(row['_id'])
        row['project_record_ids'] = list(map(str, row['project_record_ids']))
    return JsonResponse({'count': collection.count_documents(query), 'results': rows,
                         'limit': limit, 'offset': offset})
