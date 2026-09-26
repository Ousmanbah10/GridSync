from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError

from database.mongo import close_connection, get_database


class Command(BaseCommand):
    help = "Check MongoDB connectivity without writing data."

    def handle(self, *args, **options):
        try:
            get_database().command("ping")
        except ImproperlyConfigured as exc:
            raise CommandError(str(exc)) from None
        except (PyMongoError, ValueError):
            # Driver errors may contain connection details; do not print them.
            raise CommandError(
                "MongoDB connection failed. Check the URI, database user credentials, "
                "and network access settings."
            ) from None
        finally:
            close_connection()
        self.stdout.write(self.style.SUCCESS("MongoDB connection successful."))
