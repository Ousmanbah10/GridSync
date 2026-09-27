"""Grounding metadata is the source allowlist; model-invented URLs are not citations."""
import ipaddress
import re
from urllib.parse import urlsplit
from bson import ObjectId, Decimal128
from datetime import date, datetime

FIELDS = ('construction_start', 'construction_end', 'in_service', 'budget',
          'state_permitting', 'federal_permitting', 'project_status')


def public(value):
    if isinstance(value, ObjectId): return str(value)
    if isinstance(value, Decimal128): return str(value)
    if isinstance(value, (datetime, date)): return value.isoformat()
    if isinstance(value, dict): return {k: public(v) for k, v in value.items() if k != 'raw_data'}
    if isinstance(value, list): return [public(v) for v in value]
    return value


def web_url(value):
    if not isinstance(value, str) or len(value) > 3000: return None
    try:
        url = urlsplit(value)
        host = (url.hostname or '').lower()
        if url.scheme not in ('http', 'https') or not host or url.username or url.password: return None
        if url.port not in (None, 80, 443): return None
        if '.' not in host or host.endswith(('.localhost', '.local', '.internal')): return None
        try:
            if not ipaddress.ip_address(host).is_global: return None
        except ValueError:
            pass
        return value
    except ValueError:
        return None


def candidate_text(result):
    candidates = result.get('candidates') or []
    if not candidates: raise ValueError('Gemini returned no answer. Try again or check model access.')
    candidate = candidates[0]
    if candidate.get('finishReason') not in (None, 'STOP'):
        raise ValueError('Gemini did not finish the answer. No incomplete findings were saved.')
    text = '\n'.join(p.get('text', '') for p in candidate.get('content', {}).get('parts', []) if not p.get('thought'))
    if not text.strip(): raise ValueError('Gemini returned no readable answer.')
    return text, candidate


def collect_sources(candidate):
    sources, retrievals = [], []
    seen = set()
    def add(url, title, method):
        url = web_url(url)
        if url and url not in seen:
            seen.add(url)
            sources.append({'id': f'S{len(sources) + 1}', 'url': url,
                            'title': str(title or url)[:300], 'method': method})
    grounding = candidate.get('groundingMetadata', {})
    for chunk in grounding.get('groundingChunks', []):
        web = chunk.get('web', {})
        add(web.get('uri'), web.get('title'), 'google_search')
    context = candidate.get('urlContextMetadata', candidate.get('url_context_metadata', {}))
    for entry in context.get('urlMetadata', context.get('url_metadata', [])):
        url = entry.get('retrievedUrl', entry.get('retrieved_url'))
        status = entry.get('urlRetrievalStatus', entry.get('url_retrieval_status', 'UNKNOWN'))
        if web_url(url): retrievals.append({'url': url, 'status': status})
        if status == 'URL_RETRIEVAL_STATUS_SUCCESS': add(url, url, 'url_context')
    return sources, retrievals


def normalize(text):
    return re.sub(r'\s+', ' ', text).strip()


def validate_findings(output, sources, report):
    """Reject unknown sources/fields and passages not present in the saved research report."""
    if not isinstance(output, dict) or not isinstance(output.get('findings'), list):
        raise ValueError('AI returned invalid findings. Original project data was not changed.')
    allowed = {s['id'] for s in sources}
    findings, seen, rejected = [], set(), 0
    for row in output['findings'][:30]:
        if not isinstance(row, dict):
            rejected += 1; continue
        field, value, passage = row.get('field'), row.get('value'), row.get('supporting_passage')
        refs = row.get('source_ids')
        if (field not in FIELDS or not isinstance(value, str) or not value.strip() or len(value) > 600
                or not isinstance(passage, str) or not 10 <= len(passage) <= 1600
                or normalize(passage) not in normalize(report)
                or not isinstance(refs, list) or not refs or any(not isinstance(r, str) or r not in allowed for r in refs)):
            rejected += 1; continue
        identity = (field, value)
        if identity in seen: continue
        seen.add(identity)
        findings.append({'id': f'F{len(findings) + 1}', 'field': field, 'value': value,
                         'supporting_passage': passage, 'source_ids': list(dict.fromkeys(refs)),
                         'published_date': str(row.get('published_date') or '')[:80],
                         'scope_note': str(row.get('scope_note') or '')[:600],
                         'review_status': 'pending'})
    return findings, rejected
