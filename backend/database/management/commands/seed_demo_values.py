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
        parser.add_argument('--shift-years', type=int, help='Illustrative schedule: move construction and in-service dates forward N years.')

    def handle(self, *args, **options):
        try:
            db = get_database()
            now = datetime.now(timezone.utc)
            if options['remove']:
                result = db.projects.update_many({'source_id': options['source_id'], 'project_cost.basis': 'illustrative'},
                                                 {'$set': {'project_cost': None, 'updated_at': now}})
                restored = 0
                for project in db.projects.find({'source_id': options['source_id'], 'original_schedule': {'$exists': True}}):
                    db.projects.update_one({'_id': project['_id']}, {'$set': project['original_schedule'] | {'updated_at': now},
                                                                     '$unset': {'original_schedule': ''}})
                    restored += 1
                self.stdout.write(self.style.SUCCESS(f'Removed illustrative costs from {result.modified_count} projects; restored {restored} schedules.'))
                return
            if options['shift_years']:
                self.shift(db, options['source_id'], options['shift_years'], now)
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

    def shift(self, db, source_id, years, now):
        """Move every schedule forward together, so pair overlaps are unchanged. Originals are kept for --remove."""
        def later(value):
            return value.replace(year=value.year + years) if value else None
        shifted = 0
        for project in db.projects.find({'source_id': source_id}):
            original = project.get('original_schedule') or {key: project.get(key) for key in ('construction', 'in_service_date', 'in_service_year')}
            construction = original.get('construction') or {}
            update = {'original_schedule': original, 'updated_at': now,
                      'in_service_date': later(original.get('in_service_date')),
                      'in_service_year': original['in_service_year'] + years if original.get('in_service_year') else None}
            if construction.get('start_date') and construction.get('end_date'):
                update['construction'] = {'start_date': later(construction['start_date']), 'end_date': later(construction['end_date']),
                    'basis': 'illustrative', 'original_basis': construction.get('basis'),
                    'note': f'Illustrative demo schedule: filed dates moved forward {years} years. Filed dates are in the document citations.'}
            db.projects.update_one({'_id': project['_id']}, {'$set': update})
            shifted += 1
        self.stdout.write(self.style.SUCCESS(f'Shifted {shifted} schedules forward {years} years. Rerun rank_opportunities --save to refresh scores.'))
