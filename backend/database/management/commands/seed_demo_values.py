import json
from datetime import datetime, timezone
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from database.mongo import get_database, close_connection

DEFAULT = Path(__file__).resolve().parents[2] / 'demo' / 'sc_ga_illustrative.json'


class Command(BaseCommand):
    help = ('Fill missing values with clearly labeled illustrative demo figures (basis="illustrative"). '
            'Only empty fields are filled; project names must match. Use --remove to take them out again.')

    def add_arguments(self, parser):
        parser.add_argument('--source-id', required=True)
        parser.add_argument('--file', type=Path, default=DEFAULT)
        parser.add_argument('--remove', action='store_true')

    def handle(self, *args, **options):
        try:
            db = get_database()
            now = datetime.now(timezone.utc)
            if options['remove']:
                result = db.projects.update_many({'source_id': options['source_id'], 'project_cost.basis': 'illustrative'},
                                                 {'$set': {'project_cost': None, 'updated_at': now}})
                self.stdout.write(self.style.SUCCESS(f'Removed illustrative values from {result.modified_count} projects.'))
                return
            spec = json.loads(options['file'].read_text())
            filled = 0
            for record_id, values in spec['projects'].items():
                project = db.projects.find_one({'source_id': options['source_id'], 'record_id': record_id})
                if not project or project.get('project_name') != values['project_name']:
                    self.stdout.write(self.style.WARNING(f'{record_id}: not found or name differs; skipped.'))
                    continue
                if (project.get('project_cost') or {}).get('amount') is not None:
                    self.stdout.write(f'{record_id}: already has a cost; kept.')
                    continue
                cost = values['project_cost']
                db.projects.update_one({'_id': project['_id']}, {'$set': {'updated_at': now, 'project_cost': {
                    'amount': cost['amount'], 'currency': 'USD', 'basis': 'illustrative',
                    'note': 'Illustrative demo value, not a utility figure. ' + cost['reasoning']}}})
                filled += 1
                self.stdout.write(f"{record_id}: illustrative cost ${cost['amount']:,.0f}")
            self.stdout.write(self.style.SUCCESS(f'{filled} projects filled.'))
        except (ValueError, OSError) as exc:
            raise CommandError(str(exc)) from None
        finally:
            close_connection()
