from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError

from database.mongo import close_connection, get_database
from database.schema import setup_database


class Command(BaseCommand):
    help = "Create GridSync collections, validators and indexes without importing records."

    def handle(self, *args, **options):
        try:
            for name in setup_database(get_database()):
                self.stdout.write(f"Ready: {name}")
        except (ImproperlyConfigured, ValueError) as exc:
            raise CommandError(str(exc)) from None
        except PyMongoError as exc:
            raise CommandError(
                f"MongoDB setup failed ({type(exc).__name__}, code={getattr(exc, 'code', None)}). "
                "Check database access and collection/index configuration. Setup may be partial; "
                "rerunning is safe once the issue is resolved."
            ) from None
        finally:
            close_connection()
        self.stdout.write(self.style.SUCCESS("MongoDB schema ready. No data rows were imported."))
