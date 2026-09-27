"""Gemini Developer API transport; backend credentials only."""
import json
import re
from urllib.request import Request, urlopen
from django.conf import settings


def generate_content(payload):
    key = settings.GEMINI_API_KEY
    model = settings.GEMINI_MODEL
    if not key:
        raise ValueError('Add GEMINI_API_KEY to backend/.env and restart Django.')
    if not model or not re.fullmatch(r'[a-zA-Z0-9._-]+', model):
        raise ValueError('Set GEMINI_MODEL to a Gemini model ID available to your Gemini API key.')
    request = Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
    )
    with urlopen(request, timeout=45) as response:
        return json.load(response)
