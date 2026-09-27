from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError
from database.importing.overlaps import build_overlap_import, import_overlaps
from database.mongo import get_database, close_connection


class Command(BaseCommand):
    help = 'Import a projects/overlaps workbook (utility projects with endpoint coordinates) as its own source snapshot.'

    def add_arguments(self, parser):
        parser.add_argument('path', type=Path)
        parser.add_argument('--dry-run', action='store_true', help='Show what would be imported without writing.')

    def handle(self, *args, **options):
        path = options['path']
        try:
            data = build_overlap_import(path.read_bytes(), path.name)
            self.stdout.write(f"Source {data['source']['source_id']}: {len(data['projects'])} projects, "
                              f"{len(data['substations'])} mapped substations, {len(data['source']['reference_overlaps'])} reference overlaps.")
            for warning in data['warnings']:
                self.stdout.write(self.style.WARNING(warning))
            if options['dry_run']:
                self.stdout.write('Dry run only. Nothing written.')
                return
            counts = import_overlaps(get_database(), data)
            self.stdout.write(self.style.SUCCESS(f'Imported: {counts}'))
            self.stdout.write(f"Next: python manage.py enrich_from_documents --source-id {data['source']['source_id']} ... "
                              f"then python manage.py rank_opportunities --source-id {data['source']['source_id']} --save")
        except (ValueError, OSError, ImproperlyConfigured) as exc:
            raise CommandError(str(exc)) from None
        except PyMongoError:
            raise CommandError('MongoDB request failed. Rerunning is safe; existing records are kept.') from None
        finally:
            close_connection()
