"""Local project workspace. Research proposals never overwrite imported project fields."""
import json
import re
from datetime import datetime, timezone
from bson import ObjectId
from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET, require_POST
from database.mongo import get_database
from database.views import local_api
from .ai import analyze_pair, chat, research_project
from .evidence import public


def oid(value):
    if not isinstance(value, str) or not ObjectId.is_valid(value):
        raise ValueError('Invalid project or research identifier.')
    return ObjectId(value)


def body(request):
    try:
        result = json.loads(request.body)
        if not isinstance(result, dict): raise ValueError()
        return result
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Send a JSON object.') from None


def project_for(db, project_id):
    project = db.projects.find_one({'_id': oid(project_id)}, {'raw_data': 0})
    return project


@require_GET
@local_api
def projects(request):
    db = get_database()
    query = {}
    term = request.GET.get('search', '').strip()[:150]
    if term:
        query['$or'] = [{field: {'$regex': re.escape(term), '$options': 'i'}}
                        for field in ('project_name', 'owner', 'record_id', 'state_codes')]
    for param, field in [('owner', 'owner'), ('state', 'state_codes'), ('type', 'project_type')]:
        if request.GET.get(param): query[field] = request.GET[param][:200]
    try: page = max(1, min(10000, int(request.GET.get('page', 1))))
    except ValueError: raise ValueError('Page must be a number.') from None
    fields = {field: 1 for field in ('project_name', 'owner', 'project_type', 'state_codes', 'status',
              'in_service_year', 'record_id', 'project_id', 'segment', 'construction', 'project_cost',
              'origin', 'destination', 'source_urls', 'project_cost_note')}
    rows = list(db.projects.find(query, fields).sort([('project_name', 1), ('_id', 1)]).skip((page - 1) * 30).limit(30))
    filters = {key: sorted(str(v) for v in db.projects.distinct(field) if v)
               for key, field in [('owners', 'owner'), ('states', 'state_codes'), ('types', 'project_type')]}
    return JsonResponse({'projects': public(rows), 'total': db.projects.count_documents(query),
                         'page': page, 'page_size': 30, 'filters': filters})


@require_GET
@local_api
def detail(request, project_id):
    db = get_database()
    project = project_for(db, project_id)
    if not project: return JsonResponse({'error': 'Project not found.'}, status=404)
    runs = list(db.project_research.find({'project_record_id': project['_id']}).sort([('created_at', -1), ('_id', -1)]).limit(5))
    from coordination.repository import GENERATOR
    pairs = list(db.coordination_opportunities.find(
        {'project_record_ids': project['_id'], 'generated_by': GENERATOR, 'active': True},
        {'project_record_ids': 1, 'project_names': 1, 'owners': 1, 'distance_km': 1, 'distance_basis': 1, 'band': 1,
         'coordination_score': 1, 'distance_score': 1, 'shared_substations': 1, 'timeline': 1})
        .sort([('coordination_score', -1), ('distance_km', 1)]).limit(12))
    related = []
    for pair in pairs:
        index = 1 if pair['project_record_ids'][0] == project['_id'] else 0
        related.append({'id': str(pair['_id']), 'partner_id': str(pair['project_record_ids'][index]),
                        'partner_name': (pair.get('project_names') or [None, None])[index],
                        'partner_owner': (pair.get('owners') or [None, None])[index],
                        'distance_km': pair.get('distance_km'), 'distance_basis': pair.get('distance_basis'),
                        'band': pair.get('band'), 'shared_substations': pair.get('shared_substations') or [],
                        'coordination_score': pair.get('coordination_score', pair.get('distance_score')),
                        'timeline': public(pair.get('timeline'))})
    return JsonResponse({'project': public(project), 'runs': public(runs), 'related_opportunities': related,
                         'csrf_token': get_token(request),
                         'ai_configured': bool(settings.GEMINI_API_KEY and settings.GEMINI_MODEL)})


@require_POST
@local_api
def research(request, project_id):
    options = body(request)
    search = options.get('search', True)
    if not isinstance(search, bool): raise ValueError('search must be true or false.')
    db = get_database()
    project = project_for(db, project_id)
    if not project: return JsonResponse({'error': 'Project not found.'}, status=404)
    lock = 'project-research:' + project_id
    if not cache.add(lock, True, 300):
        return JsonResponse({'error': 'Research is already running for this project.'}, status=409)
    try:
        result = research_project(project, search)
        result.update(_id=ObjectId(), project_record_id=project['_id'],
                      created_at=datetime.now(timezone.utc), method_version='grounded-proposals-v1')
        db.project_research.create_index([('project_record_id', 1), ('created_at', -1)], name='project_research_history')
        db.project_research.insert_one(result)
        return JsonResponse({'run': public(result)}, status=201)
    finally:
        cache.delete(lock)


@require_POST
@local_api
def review(request, project_id, run_id):
    data = body(request)
    status = data.get('status')
    if status not in ('pending', 'reviewed', 'rejected'):
        raise ValueError('Choose pending, reviewed or rejected.')
    finding_id = data.get('finding_id')
    if not isinstance(finding_id, str) or not re.fullmatch(r'F\d+', finding_id):
        raise ValueError('Invalid finding identifier.')
    db = get_database()
    result = db.project_research.update_one(
        {'_id': oid(run_id), 'project_record_id': oid(project_id), 'findings.id': finding_id},
        {'$set': {'findings.$.review_status': status, 'findings.$.reviewed_at': datetime.now(timezone.utc)}})
    if not result.matched_count: return JsonResponse({'error': 'Finding not found for this project.'}, status=404)
    return JsonResponse({'status': status})


@require_POST
@local_api
def ask(request, project_id):
    data = body(request)
    question = data.get('question')
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000:
        raise ValueError('Ask a question between 1 and 2,000 characters.')
    db = get_database()
    project = project_for(db, project_id)
    if not project: return JsonResponse({'error': 'Project not found.'}, status=404)
    run = None
    if data.get('run_id'):
        run = db.project_research.find_one({'_id': oid(data['run_id']), 'project_record_id': project['_id']})
        if not run: return JsonResponse({'error': 'Research run not found for this project.'}, status=404)
    lock = 'project-chat:' + project_id
    if not cache.add(lock, True, 120):
        return JsonResponse({'error': 'An answer is already being generated.'}, status=409)
    try:
        return JsonResponse(chat(project, run, question.strip()))
    finally:
        cache.delete(lock)


def _analysis_projects(db, opportunity):
    ids = opportunity.get('project_record_ids') or []
    found = {p['_id']: p for p in db.projects.find({'_id': {'$in': ids}}, {'raw_data': 0})}
    return [found[i] for i in ids if i in found]


def _savings(request):
    """Optional screening estimate from the page: numbers and short labels only."""
    if not request.body or request.content_type != 'application/json':
        return None
    data = body(request).get('savings')
    if not isinstance(data, dict):
        return None
    numbers = {k: round(float(data[k]), 2) for k in ('low', 'high', 'percent', 'acres', 'miles')
               if isinstance(data.get(k), (int, float)) and abs(data[k]) < 1e12}
    levers = [{'title': str(l.get('title'))[:80], 'amount': round(float(l['amount']), 2)}
              for l in data.get('levers', [])[:6] if isinstance(l, dict) and isinstance(l.get('amount'), (int, float))]
    return numbers | {'levers': levers, 'schedule': str(data.get('schedule', ''))[:120], 'basis': 'planning assumptions (screening estimate)'} if numbers else None


@local_api
def pair_analysis(request, opportunity_id):
    """GET the latest saved brief for a candidate pair; POST generates a new one with Gemini."""
    if request.method not in ('GET', 'POST'):
        return JsonResponse({'error': 'Use GET or POST.'}, status=405)
    db = get_database()
    opportunity = db.coordination_opportunities.find_one({'_id': oid(opportunity_id)})
    if not opportunity: return JsonResponse({'error': 'Coordination candidate not found.'}, status=404)
    if request.method == 'GET':
        saved = db.coordination_analyses.find_one({'opportunity_id': opportunity['_id']}, sort=[('created_at', -1)])
        return JsonResponse({'analysis': public(saved) if saved else None, 'csrf_token': get_token(request),
                             'ai_configured': bool(settings.GEMINI_API_KEY and settings.GEMINI_MODEL)})
    projects = _analysis_projects(db, opportunity)
    if len(projects) != 2: return JsonResponse({'error': 'Both project records are required for an analysis.'}, status=409)
    lock = 'pair-analysis:' + opportunity_id
    if not cache.add(lock, True, 180):
        return JsonResponse({'error': 'An analysis is already running for this pair.'}, status=409)
    try:
        result = analyze_pair(opportunity, projects, _savings(request))
        result.update(_id=ObjectId(), opportunity_id=opportunity['_id'], created_at=datetime.now(timezone.utc))
        db.coordination_analyses.insert_one(result)
        return JsonResponse({'analysis': public(result)}, status=201)
    finally:
        cache.delete(lock)
