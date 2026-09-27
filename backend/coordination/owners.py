"""Owner-name normalization and company aliasing.

Co-owners are separated by commas or semicolons only. "And"/"&" are part of
names such as "Pacific Gas and Electric Company", so they are never split.
Edit ALIASES / PREFIXES to add or correct company groupings.
"""
import re
from .locations import normalize

UNKNOWN = {'', 'unknown', 'n/a', 'na', 'none', 'tbd'}

# Exact cleaned name -> company group. Subsidiaries map to their parent company,
# because coordination between affiliates is internal, not cross-utility.
ALIASES = {
    'virginia electric and power company': 'dominion',
    'southern california edsion': 'southern california edison',
    'american transmission company': 'american transmission company atc',
    'atc': 'american transmission company atc',
    'wapa': 'western area power administration',
    'new york power authority': 'new york power authority',
    'nypa': 'new york power authority',
    'florida power and light': 'nextera',
    'neet': 'nextera',
    'horizon west transmission': 'nextera',
    'great basin transmission llc': 'ls power',
    'jersey central power and light': 'firstenergy',
    'penelec': 'firstenergy',
    'met ed': 'firstenergy',
    'american transmission systems': 'firstenergy',
    'first energy': 'firstenergy',
    'northern states power company': 'xcel energy',
    'southwestern public service': 'xcel energy',
    'commonwealth edison': 'exelon',
    'peco': 'exelon',
    'baltimore gas and electric company': 'exelon',
    'delmarva power and light company': 'exelon',
    'oge': 'oklahoma gas and electric company',
    'public service enterprise group renewable generation llc': 'pseg',
    'ppl corporation': 'ppl',
    'ppl electric utilities': 'ppl',
    'arizona public service': 'arizona public service',
}

# Any cleaned name starting with one of these belongs to that group.
PREFIXES = ('dominion', 'duke energy', 'entergy', 'ameren', 'aep', 'itc', 'ls power',
            'transource', 'hydro quebec', 'eversource', 'nextera', 'montana dakota utilities',
            'basin electric power cooperative', 'western area power administration',
            'new york transco', 'pacificorp', 'exelon')


def clean(name):
    text = normalize(name)
    text = re.sub(r'\([^)]*\)', ' ', text)          # drop "(ATC)", "(PG&E)" abbreviations
    text = text.replace('&', ' and ')
    text = re.sub(r'[^\w]+', ' ', text).strip()
    text = re.sub(r'^the ', '', text)
    return ' '.join(text.split())


def canonical(name):
    text = clean(name)
    if text in ALIASES:
        return ALIASES[text]
    for prefix in PREFIXES:
        if text == prefix or text.startswith(prefix + ' '):
            return prefix
    return text


def owner_groups(value):
    """Set of company groups named in an owner cell; empty when unknown."""
    if normalize(value) in UNKNOWN:
        return set()
    return {canonical(part) for part in re.split(r'\s*[,;]\s*', normalize(value)) if clean(part)}
