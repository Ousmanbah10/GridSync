"""Lazy, shared MongoDB connection for application data."""
import atexit
from threading import Lock

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from pymongo import MongoClient

_client = None
_lock = Lock()


def get_database():
    global _client
    if not settings.MONGODB_URI or not settings.MONGODB_DATABASE:
        raise ImproperlyConfigured("Set MONGODB_URI and MONGODB_DATABASE in backend/.env.")
    with _lock:
        if _client is None:
            _client = MongoClient(
                settings.MONGODB_URI,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=5000,
                appname="GridSync",
                connect=False,
            )
    return _client[settings.MONGODB_DATABASE]


def close_connection():
    global _client
    with _lock:
        if _client is not None:
            _client.close()
            _client = None


atexit.register(close_connection)
