from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError

from database.mongo import close_connection, get_database
from database.schema import setup_database, update_schemas


class Command(BaseCommand):
    help = "Create GridSync collections, validators and indexes without importing records."

    def add_arguments(self, parser):
        parser.add_argument('--update-schema', nargs='+', metavar='COLLECTION',
                            help='Explicitly apply the current validator to existing collections, e.g. coordination_opportunities.')

    def handle(self, *args, **options):
        try:
            for name in update_schemas(get_database(), options['update_schema'] or []):
                self.stdout.write(f"Schema updated: {name}")
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
