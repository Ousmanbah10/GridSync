"""Local development import API. Add authentication before remote deployment."""
from functools import wraps
import json
from pathlib import Path
from uuid import uuid4
from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET, require_POST
from pymongo.errors import PyMongoError
from .mongo import get_database
from .importing.service import build_preview, public_preview, import_preview
from .importing.workbook import MAX_FILE_BYTES


def local_api(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not settings.DEBUG or request.META.get('REMOTE_ADDR') not in ('127.0.0.1', '::1'):
            return JsonResponse({'error': 'The import workspace is available only on this development machine.'}, status=403)
        try:
            return view(request, *args, **kwargs)
        except (ValueError, ImproperlyConfigured) as exc:
            return JsonResponse({'error': str(exc)}, status=400)
        except PyMongoError:
            return JsonResponse({'error': 'MongoDB could not finish the request. Check the connection and retry. Any rows already saved will be kept without duplicates.'}, status=503)
    return wrapper


@require_GET
@local_api
def status(request):
    result = {'csrf_token': get_token(request), 'gemini_ready': bool(settings.GEMINI_API_KEY and settings.GEMINI_MODEL),
              'gemini_model': settings.GEMINI_MODEL, 'database_ready': False, 'counts': None}
    try:
        db = get_database()
        db.command('ping')
        result['counts'] = {name: db[name].count_documents({}) for name in ('projects', 'substations', 'sources')}
        result['database_ready'] = True
    except (PyMongoError, ImproperlyConfigured):
        pass
    return JsonResponse(result)


@require_POST
@local_api
def preview(request):
    use_ai = request.POST.get('use_ai') == 'true'
    if request.POST.get('sample') == 'true':
        path = settings.BASE_DIR / 'OurGridFuture_PlannedTransmissionProjects_Jun2026.xlsx'
        content, filename = path.read_bytes(), path.name
    else:
        upload = request.FILES.get('file')
        if not upload or not upload.name.lower().endswith('.xlsx'):
            raise ValueError('Choose an .xlsx workbook.')
        if upload.size > MAX_FILE_BYTES:
            raise ValueError('Choose a workbook smaller than 10 MB.')
        content, filename = upload.read(), Path(upload.name).name
    data = build_preview(content, filename, use_ai)
    token = uuid4().hex
    # Process-local previews expire after 30 minutes; the browser cannot change saved rows.
    cache.set('import:' + token, data, timeout=1800)
    return JsonResponse(public_preview(data) | {'token': token})


@require_POST
@local_api
def commit(request):
    try:
        body = json.loads(request.body)
        token = body.get('token')
    except (ValueError, AttributeError):
        raise ValueError('Invalid import request.') from None
    if not isinstance(token, str) or len(token) != 32:
        raise ValueError('Preview the workbook before importing.')
    data = cache.get('import:' + token)
    if data is None:
        raise ValueError('This preview expired or the server restarted. Preview the workbook again.')
    if not cache.add('import-lock', True, timeout=300):
        return JsonResponse({'error': 'An import is already running. Wait a moment and retry.'}, status=409)
    try:
        result = import_preview(get_database(), data)
        return JsonResponse({'counts': result})
    finally:
        cache.delete('import-lock')

